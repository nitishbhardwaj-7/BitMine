import { pino } from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const pretty = process.env.NODE_ENV === "development";

export const logger = pino({
  level,
  redact: {
    paths: ["req.headers.authorization", "*.password", "*.token", "*.refreshToken", "*.otp"],
    censor: "[redacted]",
  },
  ...(pretty ? { transport: { target: "pino-pretty", options: { singleLine: true } } } : {}),
});
