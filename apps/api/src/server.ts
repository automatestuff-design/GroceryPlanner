import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { backendFromEnv } from "./backend";

const port = Number(process.env.PORT ?? 8787);
const backend = backendFromEnv();
const app = createApp({ backend, appUrl: process.env.APP_URL });
serve({ fetch: app.fetch, port }, () => console.log(`Meal planner API on http://localhost:${port} (${backend.mode} backend)`));
