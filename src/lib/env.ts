import { z } from "zod";

const envSchema = z.object({
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    API_URL: z.string().default("http://localhost:3000"),
    INTERNAL_SECRET: z.string().min(32, "INTERNAL_SECRET must be at least 32 chars"),

    TWITCH_CLIENT_ID: z.string().optional(),
    TWITCH_USE_LOCAL_MOCK: z.coerce.boolean().optional(),

    CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const env = parsed.data;
