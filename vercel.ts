import { routes, type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "node db/migrate.js && npm run build",
  // Daily live layer: rates, GDELT conflict signals, GDACS disasters, FX → automatic adjustments.
  crons: [{ path: "/api/cron/live", schedule: "15 6 * * *" }],
  headers: [
    routes.cacheControl("/api/v1/(.*)", { public: true, maxAge: "1 hour", staleWhileRevalidate: "1 day" }),
  ],
};
