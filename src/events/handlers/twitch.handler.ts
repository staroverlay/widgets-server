import { logger } from "@/logger";
import { env } from "@/lib/env";
import { TWITCH_EVENT_MAP } from "./twitch.events";

/** Emitter injected by EventManager to push events to widgets */
export type EmitFn = (eventId: string, data: any) => void;

const MOCK = env.TWITCH_USE_LOCAL_MOCK === true;
const TWITCH_EVENTSUB_WS_URL = MOCK
    ? "ws://localhost:8080/ws"
    : "wss://eventsub.wss.twitch.tv/ws";
const TWITCH_API_BASE = MOCK ? "http://localhost:8080" : "https://api.twitch.tv/helix";

//

export class TwitchSession {
    private ws: WebSocket | null = null;
    private sessionId: string | null = null;

    private clientId: string;
    private integrationId: string;
    private channelId: string;
    private emit: EmitFn;

    private accessToken: string;
    private widgetToken: string;

    private activeSubscriptions = new Map<string, string>(); // eventId → subId
    private pendingEvents = new Set<string>();

    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;
    private ready = false;

    constructor(opts: {
        integrationId: string;
        clientId: string;
        channelId: string;
        accessToken: string;
        widgetToken: string;
        emit: EmitFn;
    }) {
        this.integrationId = opts.integrationId;
        this.clientId = opts.clientId;
        this.channelId = opts.channelId;
        this.accessToken = opts.accessToken;
        this.widgetToken = opts.widgetToken;
        this.emit = opts.emit;
        this.initialize();
    }

    public updateTokens(accessToken: string, widgetToken: string) {
        this.accessToken = accessToken;
        this.widgetToken = widgetToken;
        logger.debug(`[Twitch:${this.integrationId}] Tokens updated.`);
    }

    public addEvent(eventId: string) {
        if (this.activeSubscriptions.has(eventId) || this.pendingEvents.has(eventId)) return;
        logger.info(`[Twitch:${this.integrationId}] Queuing event "${eventId}"`);
        this.pendingEvents.add(eventId);
        if (this.ready && this.sessionId) {
            this.registerPending();
        }
    }

    public async removeEvent(eventId: string) {
        this.pendingEvents.delete(eventId);
        const subId = this.activeSubscriptions.get(eventId);
        if (!subId) return;

        this.activeSubscriptions.delete(eventId);
        logger.info(`[Twitch:${this.integrationId}] Revoking "${eventId}" (subId: ${subId})`);

        try {
            await fetch(`${TWITCH_API_BASE}/eventsub/subscriptions?id=${subId}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    "Client-Id": this.clientId,
                },
            });
        } catch (err) {
            logger.warn(`[Twitch:${this.integrationId}] Failed to revoke subscription: ${err}`);
        }
    }

    public get eventCount() {
        return this.activeSubscriptions.size + this.pendingEvents.size;
    }

    public dispose() {
        this.disposed = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }
        this.activeSubscriptions.clear();
        this.pendingEvents.clear();
        logger.warn(`[Twitch:${this.integrationId}] Session disposed.`);
    }

    private async initialize() {
        // We already have the accessToken injected from the widget token initially!
        this.ready = true;
        this.connect();
    }

    private connect() {
        if (this.disposed) return;
        logger.info(`[Twitch:${this.integrationId}] Connecting to EventSub WS...`);

        const ws = new WebSocket(TWITCH_EVENTSUB_WS_URL);
        this.ws = ws;

        ws.onopen = () => {
            logger.info(`[Twitch:${this.integrationId}] WS connection opened.`);
        };

        ws.onmessage = (ev) => {
            try {
                this.handleMessage(JSON.parse(ev.data as string));
            } catch (err) {
                logger.error(`[Twitch:${this.integrationId}] Failed to parse WS message: ${err}`);
            }
        };

        ws.onerror = (ev) => {
            logger.error(`[Twitch:${this.integrationId}] WS error: ${ev}`);
        };

        ws.onclose = () => {
            if (this.disposed) return;
            this.sessionId = null;
            logger.warn(`[Twitch:${this.integrationId}] Disconnected. Reconnecting in 5s...`);
            this.reconnectTimer = setTimeout(() => this.connect(), 5_000);
        };
    }

    private handleMessage(msg: any) {
        const msgType: string = msg?.metadata?.message_type;

        switch (msgType) {
            case "session_welcome": {
                this.sessionId = msg.payload?.session?.id;
                logger.info(`[Twitch:${this.integrationId}] Session ready: ${this.sessionId}`);
                this.registerPending(); // Might fail if token expired since connection
                break;
            }

            case "session_reconnect": {
                const newUrl: string = msg.payload?.session?.reconnect_url;
                if (!newUrl || !newUrl.startsWith("wss://eventsub.wss.twitch.tv/")) {
                    logger.error(`[Twitch:${this.integrationId}] Invalid reconnect URL: ${newUrl}`);
                    return;
                }
                logger.warn(`[Twitch:${this.integrationId}] Reconnect → ${newUrl}`);
                for (const [eventId] of this.activeSubscriptions) {
                    this.pendingEvents.add(eventId);
                }
                this.activeSubscriptions.clear();
                this.sessionId = null;

                const oldWs = this.ws!;
                const newWs = new WebSocket(newUrl);
                this.ws = newWs;
                newWs.onopen = oldWs.onopen;
                newWs.onmessage = oldWs.onmessage;
                newWs.onerror = oldWs.onerror;
                newWs.onclose = oldWs.onclose;
                newWs.addEventListener("open", () => oldWs.close());
                break;
            }

            case "notification": {
                const eventType: string = msg?.payload?.subscription?.type;
                const eventData = msg?.payload?.event;
                const eventId = Object.entries(TWITCH_EVENT_MAP).find(
                    ([, def]) => def.type === eventType
                )?.[0];
                if (eventId && eventData) {
                    this.emit(eventId, eventData);
                }
                break;
            }

            case "revocation": {
                const subId = msg?.payload?.subscription?.id;
                const reason = msg?.payload?.subscription?.status;
                logger.warn(`[Twitch:${this.integrationId}] Subscription revoked: ${subId} (${reason})`);
                for (const [evtId, sid] of this.activeSubscriptions) {
                    if (sid === subId) { this.activeSubscriptions.delete(evtId); break; }
                }
                break;
            }

            case "session_keepalive":
                break;

            default:
                logger.debug(`[Twitch:${this.integrationId}] Unknown message type: ${msgType}`);
        }
    }

    private async registerPending() {
        if (!this.sessionId) return;
        const toRegister = [...this.pendingEvents];
        this.pendingEvents.clear();
        for (const eventId of toRegister) {
            await this.registerSubscription(eventId);
        }
    }

    private async registerSubscription(eventId: string): Promise<void> {
        const def = TWITCH_EVENT_MAP[eventId];
        if (!def) {
            logger.warn(`[Twitch:${this.integrationId}] Unknown event "${eventId}" — skipping.`);
            return;
        }

        const body = {
            type: def.type,
            version: def.version,
            condition: def.condition(this.channelId),
            transport: { method: "websocket", session_id: this.sessionId! },
        };

        const executeRegister = async (token: string) => {
            return fetch(`${TWITCH_API_BASE}/eventsub/subscriptions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Client-Id": this.clientId,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            });
        };

        try {
            let res = await executeRegister(this.accessToken);

            // If token expired, try to fetch a new one from the backend
            if (res.status === 401 && this.widgetToken) {
                logger.info(`[Twitch:${this.integrationId}] Token returned 401, trying to refresh via backend...`);
                try {
                    const authRes = await fetch(`${env.API_URL}/internal/widget?token=${this.widgetToken}`, {
                        headers: { Authorization: `Bearer ${env.INTERNAL_SECRET}` }
                    });
                    if (authRes.ok) {
                        const data = await authRes.json() as any;
                        const integration = data.integrations?.find((i: any) => i.id === this.integrationId);
                        if (integration && integration.access_token) {
                            this.accessToken = integration.access_token;
                            res = await executeRegister(this.accessToken);
                        }
                    }
                } catch (rErr) {
                    logger.error(`[Twitch:${this.integrationId}] Auto refresh failed: ${rErr}`);
                }
            }

            if (!res.ok) {
                const err = await res.text();
                logger.error(`[Twitch:${this.integrationId}] Failed to register "${eventId}": ${res.status} - ${err}`);
                return;
            }

            const json = await res.json() as any;
            const subId: string | null = json?.data?.[0]?.id ?? null;
            if (subId) {
                this.activeSubscriptions.set(eventId, subId);
                logger.info(`[Twitch:${this.integrationId}] Registered "${eventId}" → subId: ${subId}`);
            }
        } catch (err) {
            logger.error(`[Twitch:${this.integrationId}] Network error registering "${eventId}": ${err}`);
        }
    }
}

// Session pool

const pool = new Map<string, TwitchSession>();

export const getOrCreateSession = (opts: {
    integrationId: string;
    clientId: string;
    channelId: string;
    accessToken: string;
    widgetToken: string;
    emit: EmitFn;
}): TwitchSession => {
    if (!pool.has(opts.integrationId)) {
        pool.set(opts.integrationId, new TwitchSession(opts));
    }
    return pool.get(opts.integrationId)!;
};

export const getSession = (integrationId: string) => pool.get(integrationId);

export const removeSession = (integrationId: string) => {
    const session = pool.get(integrationId);
    if (session) {
        session.dispose();
        pool.delete(integrationId);
    }
};
