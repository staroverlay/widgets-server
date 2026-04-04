import { Elysia } from "elysia";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@/logger";

// Resolve the apps directory from the current working directory of the widgets app
const APPS_DIR = join(process.cwd(), "apps");

interface AppMetadata {
    id: string;
    name: string;
    description: string;
    version: string;
    category: string;
    compatible_with: string[];
    created_at: string;
    updated_at: string;
    metaImages?: string[];
}

let cachedAppsData: AppMetadata[] = [];

/**
 * Loads the meta/app.json from every app in widgets/apps/
 * and stores it in memory.
 */
function loadAppsMetadata() {
    logger.info("[Apps] Loading apps metadata from memory...");
    const appIndex: AppMetadata[] = [];

    if (!existsSync(APPS_DIR)) {
        logger.warn(`[Apps] APPS_DIR not found: ${APPS_DIR}`);
        cachedAppsData = appIndex;
        return;
    }

    const apps = readdirSync(APPS_DIR).filter((f) => {
        try {
            return statSync(join(APPS_DIR, f)).isDirectory();
        } catch {
            return false;
        }
    });

    for (const app of apps) {
        const metaPath = join(APPS_DIR, app, "meta", "app.json");

        if (!existsSync(metaPath)) {
            logger.debug(`[Apps] Skipping ${app} (no meta/app.json)`);
            continue;
        }

        try {
            const rawJson = readFileSync(metaPath, "utf-8");
            const appConfig = JSON.parse(rawJson);

            // Validations
            if (appConfig.id !== app) {
                logger.warn(`[Apps] Skipped ${app}: ID in app.json (${appConfig.id}) does not match folder name.`);
                continue;
            }

            const {
                id,
                name,
                description,
                version,
                category,
                compatible_with,
                created_at,
                updated_at,
            } = appConfig;

            appIndex.push({
                id,
                name,
                description,
                version,
                category,
                compatible_with,
                created_at,
                updated_at,
            });
            logger.info(`[Apps] Loaded metadata for: ${app}`);
        } catch (error: any) {
            logger.error(`[Apps] Failed to parse meta/app.json for ${app}: ${error.message}`);
        }
    }

    cachedAppsData = appIndex;
    logger.info(`[Apps] Successfully loaded ${cachedAppsData.length} app(s).`);
}

// Load metadata immediately on startup
loadAppsMetadata();

export const appsRoutesPlugin = new Elysia()
    .get("/apps", () => cachedAppsData)
    .get("/apps.json", () => cachedAppsData)
    // Static app meta serving
    .get("/apps/:appId/*", ({ params }) => {
        const { appId } = params;
        const rest = (params as any)["*"] as string ?? "";

        if (/[/\\]/.test(appId)) {
            return new Response("Not found", { status: 404 });
        }

        const metaDir = join(APPS_DIR, appId, "meta");
        if (!existsSync(metaDir)) {
            return new Response("Not found", { status: 404 });
        }

        const resolved = join(metaDir, rest);
        if (!resolved.startsWith(metaDir + "/") && resolved !== metaDir) {
            return new Response("Forbidden", { status: 403 });
        }

        if (!existsSync(resolved) || statSync(resolved).isDirectory()) {
            return new Response("Not found", { status: 404 });
        }

        const file = Bun.file(resolved);
        return new Response(file, { headers: { "Cache-Control": "public, max-age=3600", "Content-Type": file.type } });
    });
