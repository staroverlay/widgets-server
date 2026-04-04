import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

import { env } from "./lib/env";
import { logger } from "./logger";
import { eventsPlugin } from "./events";
import { staticPlugin } from "./routes/static.routes";
import { appsRoutesPlugin } from "./routes/apps.routes";

// App
const app = new Elysia();

// CORS — allow the UI origins configured in the environment
const allowedOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);

app.use(
    cors({
        origin: allowedOrigins,
        credentials: true,
        allowedHeaders: ["Content-Type"],
        methods: ["GET", "OPTIONS"],
    })
);

// Security headers (minimal — this server only serves static files + WS)
app.onAfterHandle(({ set }) => {
    set.headers["X-Content-Type-Options"] = "nosniff";
    set.headers["Content-Security-Policy"] = `frame-ancestors 'self' ${allowedOrigins.join(" ")}`;
    set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
});

// Health check
app.get("/health", () => ({
    status: "ok",
    service: "widget-server",
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
}));

// Apps metadata registry
app.use(appsRoutesPlugin);

// WebSocket events endpoint
// Handles: WS  /events/widget?token=<widget-token>
app.use(eventsPlugin);

// Static widget serving
// Handles: GET /widget/:appId
//          GET /widget/:appId/*
app.use(staticPlugin);

// Global error handler
app.onError(({ code, error, set }) => {
    if (env.NODE_ENV !== "production") {
        logger.error(`[${code}] ${error}`);
    }

    if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "Not found" };
    }

    set.status = 500;
    return { error: "Internal server error" };
});

// Start
app.listen(env.PORT, () => {
    logger.info(`widget-server running on "${env.NODE_ENV}" mode`);
    logger.info(`Listening at http://localhost:${env.PORT}`);
    logger.info(`Static widgets at http://localhost:${env.PORT}/widget/<app-id>`);
    logger.info(`WebSocket events at ws://localhost:${env.PORT}/events/widget?token=<token>`);
});
