import { routes, type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "node db/migrate.js && npm run build",
  headers: [
    routes.cacheControl("/api/v1/(.*)", { public: true, maxAge: "1 hour", staleWhileRevalidate: "1 day" }),
  ],
};
