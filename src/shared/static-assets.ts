import type { Hono } from "hono";
import { serveStatic } from "hono/bun";

export const registerStaticAssetRoutes = (app: Hono) => {
  app.use("/icon.svg", serveStatic({ path: "./public/icon.svg" }));
  app.use("/dev-reload.js", serveStatic({ path: "./public/dev-reload.js" }));
};
