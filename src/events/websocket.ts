import { Elysia, t } from "elysia";
import { logger } from "@/logger";
import { eventManager } from "./manager";
import { env } from "@/lib/env";

export interface WebSocketData {
    widgetId: string;
    userId: string;
    integrationIds: string[];
    integrations: Array<{
        id: string;
        public: any;
        access_token: string;
    }>;
    widget: any;
    widgetToken: string;
}

const widgetSockets = new Map<string, Set<any>>();

export const emitToWidget = (widgetId: string, event: string, data: any) => {
    const sockets = widgetSockets.get(widgetId);
    if (!sockets || sockets.size === 0) return;
    const payload = JSON.stringify({ event, data });
    for (const ws of sockets) {
        try { ws.send(payload); } catch { /* stale */ }
    }
};

export const eventsPlugin = new Elysia({ prefix: "/events" })
    .resolve(async ({ query, set }) => {
        const { token } = query as { token?: string };

        if (!token) {
            set.status = 401;
            throw new Error("Missing token");
        }

        try {
            // Call the secure internal backend endpoint
            const res = await fetch(`${env.API_URL}/internal/widget?token=${token}`, {
                headers: {
                    Authorization: `Bearer ${env.INTERNAL_SECRET}`,
                },
            });

            if (!res.ok) {
                const errBody = await res.text();
                logger.error(`[WS] Backend returned ${res.status}: ${errBody}`);
                set.status = res.status;
                throw new Error("Failed to authenticate widget");
            }

            const data = await res.json() as any;

            if (data.error) {
                set.status = 401;
                throw new Error(data.error);
            }

            const widget = data.widget;
            const integrations = data.integrations;

            return {
                widgetId: widget.id,
                userId: widget.userId,
                widgetToken: token,
                integrations,
                widget: {
                    id: widget.id,
                    appId: widget.appId,
                    displayName: widget.displayName,
                    settings: widget.settings,
                    integrations: widget.integrations,
                    createdAt: widget.createdAt,
                    updatedAt: widget.updatedAt,
                    enabled: widget.enabled,
                },
            };
        } catch (error: any) {
            logger.error(`[WS] Auth error: ${error.message}`);
            set.status = set.status === 200 ? 500 : set.status;
            throw error;
        }
    })
    .ws("/widget", {
        query: t.Object({
            token: t.String({ minLength: 1 }),
        }),

        open(ws) {
            const data = ws.data as unknown as WebSocketData;
            const { widgetId, userId, integrations, widget } = data;

            logger.info(`[WS] Connected — widget=${widgetId}, user=${userId}`);

            if (!widgetSockets.has(widgetId)) widgetSockets.set(widgetId, new Set());
            widgetSockets.get(widgetId)!.add(ws);

            ws.subscribe(`widget:${widgetId}`);
            ws.subscribe(`user:${userId}`);
            for (const integration of integrations) {
                ws.subscribe(`user:${userId}:${integration.public.provider}`);
            }

            ws.send({ event: "widget:data", data: widget });
        },

        message(ws, rawMessage) {
            const data = ws.data as unknown as WebSocketData;

            try {
                const message = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
                const { event, data: payload } = message;

                if (event === "ping") {
                    ws.send({ event: "pong", timestamp: Date.now() });
                    return;
                }

                if (event === "subscribe") {
                    const { integrationId, eventId } = payload ?? {};
                    if (!integrationId || !eventId) return;

                    const fullIntegration = data.integrations?.find(
                        (i: any) => i.id === integrationId
                    );

                    if (!fullIntegration) {
                        logger.warn(
                            `[WS] Security: user ${data.userId} tried to subscribe to unknown integration ${integrationId}`
                        );
                        return;
                    }

                    // Pass the fullIntegration (which has the access_token and widgetToken)
                    // We modify it here to include the widgetToken so the TwitchSession can refresh if strictly needed
                    const integrationWithToken = { ...fullIntegration, widgetToken: data.widgetToken };
                    eventManager.subscribe(ws, integrationWithToken, eventId);
                    return;
                }

                if (event === "unsubscribe") {
                    const { integrationId, eventId } = payload ?? {};
                    if (!integrationId || !eventId) return;
                    eventManager.unsubscribe(ws, integrationId, eventId);
                    return;
                }
            } catch {
                if (rawMessage === "ping") {
                    ws.send({ event: "pong", timestamp: Date.now() });
                }
            }
        },

        close(ws) {
            const data = ws.data as unknown as WebSocketData;
            if (data?.widgetId) {
                logger.debug(`[WS] Disconnected — widget=${data.widgetId}`);
                eventManager.unsubscribeAll(ws);

                const sockets = widgetSockets.get(data.widgetId);
                if (sockets) {
                    sockets.delete(ws);
                    if (sockets.size === 0) widgetSockets.delete(data.widgetId);
                }
            }
            ws.data = {} as any;
        },
    });
