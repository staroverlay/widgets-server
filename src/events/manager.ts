import { logger } from "@/logger";
import { env } from "@/lib/env";
import { getOrCreateSession, getSession, removeSession } from "./handlers/twitch.handler";

type SubscriptionKey = string; // `${integrationId}.${eventId}`

export class EventManager {
    private static instance: EventManager;

    private sockets = new Map<SubscriptionKey, Set<any>>();
    private socketTopics = new Map<any, Set<SubscriptionKey>>();
    private graceTimers = new Map<SubscriptionKey, ReturnType<typeof setTimeout>>();

    private constructor() { }

    public static getInstance(): EventManager {
        if (!EventManager.instance) EventManager.instance = new EventManager();
        return EventManager.instance;
    }

    public subscribe(ws: any, integration: any, eventId: string) {
        const key = this.key(integration.id, eventId);

        if (!this.sockets.has(key)) this.sockets.set(key, new Set());
        const set = this.sockets.get(key)!;

        // Add socket to set
        if (!set.has(ws)) {
            set.add(ws);
            if (!this.socketTopics.has(ws)) this.socketTopics.set(ws, new Set());
            this.socketTopics.get(ws)!.add(key);
        }

        const refCount = set.size;
        logger.info(`EventManager: +1 [${key}] → refCount: ${refCount}`);

        if (this.graceTimers.has(key)) {
            clearTimeout(this.graceTimers.get(key)!);
            this.graceTimers.delete(key);
            logger.info(`EventManager: Grace timer cancelled for [${key}]`);
        }

        if (refCount === 1) {
            this.startProvider(integration, eventId);
        } else {
            // If already started, the session probably exists. Queue the event.
            const session = getSession(integration.id);
            if (session) {
                // Ensure the session has the latest tokens
                session.updateTokens(integration.access_token, integration.widgetToken);
                session.addEvent(eventId);
            }
        }
    }

    public unsubscribe(ws: any, integrationId: string, eventId: string) {
        const key = this.key(integrationId, eventId);
        const set = this.sockets.get(key);
        if (!set || !set.has(ws)) return;

        set.delete(ws);
        const topics = this.socketTopics.get(ws);
        if (topics) {
            topics.delete(key);
            if (topics.size === 0) this.socketTopics.delete(ws);
        }

        const remaining = set.size;
        logger.info(`EventManager: -1 [${key}] → remaining: ${remaining}`);

        if (remaining === 0) {
            this.beginGracePeriod(integrationId, eventId);
        }
    }

    public unsubscribeAll(ws: any) {
        const topics = this.socketTopics.get(ws);
        if (!topics) return;

        const topicsToLeave = [...topics];
        for (const key of topicsToLeave) {
            const separatorIndex = key.indexOf("###");
            if (separatorIndex === -1) { topics.delete(key); continue; }
            const integrationId = key.slice(0, separatorIndex);
            const eventId = key.slice(separatorIndex + 3);
            this.unsubscribe(ws, integrationId, eventId);
        }
        this.socketTopics.delete(ws);
    }

    public emit(integrationId: string, eventId: string, data: any) {
        const key = this.key(integrationId, eventId);
        const set = this.sockets.get(key);
        if (!set || set.size === 0) return;

        const payload = JSON.stringify({
            event: "integration:event",
            data: { integrationId, eventId, event: data },
        });

        for (const ws of set) {
            try { ws.send(payload); } catch { /* stale */ }
        }
    }

    private key(integrationId: string, eventId: string): SubscriptionKey {
        return `${integrationId}###${eventId}`;
    }

    private startProvider(integration: any, eventId: string) {
        const { id: integrationId, public: pub, access_token, widgetToken } = integration;
        const provider = pub.provider;

        logger.info(`EventManager: startProvider [${provider}] integration=${integrationId} event=${eventId}`);

        if (provider === "twitch") {
            if (!env.TWITCH_CLIENT_ID) {
                logger.error("EventManager: TWITCH_CLIENT_ID is not configured.");
                return;
            }
            const session = getOrCreateSession({
                integrationId,
                clientId: env.TWITCH_CLIENT_ID,
                channelId: pub.providerUserId || pub.providerUsername,
                accessToken: access_token,
                widgetToken: widgetToken,
                emit: (evtId: string, data: any) => this.emit(integrationId, evtId, data),
            });

            session.addEvent(eventId);
        }
    }

    private beginGracePeriod(integrationId: string, eventId: string) {
        const key = this.key(integrationId, eventId);
        if (this.graceTimers.has(key)) return;

        logger.info(`EventManager: Grace period started for [${key}]`);
        const timer = setTimeout(() => {
            const set = this.sockets.get(key);
            if (!set || set.size === 0) {
                logger.info(`EventManager: Grace period expired for [${key}]. Disposing.`);
                this.disposeProvider(integrationId, eventId);
                this.sockets.delete(key);
            }
            this.graceTimers.delete(key);
        }, 30_000);
        this.graceTimers.set(key, timer);
    }

    private disposeProvider(integrationId: string, eventId: string) {
        const session = getSession(integrationId);
        if (session) {
            session.removeEvent(eventId);
            if (session.eventCount === 0) {
                removeSession(integrationId);
            }
        }
    }
}

export const eventManager = EventManager.getInstance();
