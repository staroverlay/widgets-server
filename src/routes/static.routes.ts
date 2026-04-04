import { Elysia } from "elysia";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { logger } from "@/logger";

/**
 * Static widget serving route.
 *
 * GET /widget/:appId            → serves apps_dist/<appId>/index.html
 * GET /widget/:appId/*          → serves apps_dist/<appId>/<rest>
 *
 * `apps_dist/` lives next to `src/` and is gitignored.
 * Each sub-directory corresponds to one app-id, e.g.:
 *   apps_dist/chat-widget/index.html
 *   apps_dist/chat-widget/assets/main.js
 *
 * Security:
 *  - Path traversal is prevented by resolving to a real path and
 *    asserting it stays within the expected base directory.
 *  - No token is required for static assets — the widget HTML/JS is
 *    public. The WebSocket connection established by the widget uses
 *    the token for authentication.
 */

// Resolve the apps directory from the current working directory of the widgets app
const APPS_DIR = join(process.cwd(), "apps");

function serveWidgetFile(appId: string, filePath: string): Response {
    // Sanitise appId — no path separators allowed
    if (/[/\\]/.test(appId)) {
        return new Response("Not found", { status: 404 });
    }

    const appDir = join(APPS_DIR, appId, "dist");

    if (!existsSync(appDir)) {
        logger.warn(`[Static] App not found: ${appId}`);
        return new Response("Widget app not found", { status: 404 });
    }

    // Resolve the requested file path
    const resolved = join(appDir, filePath);

    // Path traversal guard — ensure we stay inside appDir
    if (!resolved.startsWith(appDir + "/") && resolved !== appDir) {
        logger.warn(`[Static] Path traversal attempt: ${resolved}`);
        return new Response("Forbidden", { status: 403 });
    }

    // Serve index.html for directory requests
    const target = existsSync(resolved) && !filePath.endsWith("/")
        ? resolved
        : join(resolved, "index.html");

    if (!existsSync(target)) {
        // SPA fallback — serve index.html for client-side routing
        const fallback = join(appDir, "index.html");
        if (existsSync(fallback)) {
            const file = Bun.file(fallback);
            return new Response(file, { headers: { "Content-Type": file.type } });
        }
        return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(target);
    return new Response(file, { headers: { "Content-Type": file.type } });
}

export const staticPlugin = new Elysia({ prefix: "/widget" })
    // Catch-all wildcard for asset files inside a widget app
    .get("/:appId/*", ({ params }) => {
        const { appId } = params;
        // Elysia exposes the wildcard as params["*"]
        const rest = (params as any)["*"] as string ?? "";
        logger.debug(`[Static] GET /widget/${appId}/${rest}`);
        return serveWidgetFile(appId, rest);
    })
    // Root of a widget app (index.html)
    .get("/:appId", ({ params }) => {
        logger.debug(`[Static] GET /widget/${params.appId}`);
        return serveWidgetFile(params.appId, "index.html");
    });
