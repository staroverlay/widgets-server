import pino from "pino";
import { env } from "@/lib/env";

export const loggerStream =
    env.NODE_ENV === "production"
        ? undefined
        : pino.transport({
            target: "pino-pretty",
            options: { colorize: true },
        });

export const logger = pino(
    { level: env.NODE_ENV === "production" ? "info" : "debug" },
    loggerStream
);
