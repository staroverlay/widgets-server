import { z } from "zod";

const envSchema = z.object({
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const env = parsed.data;
