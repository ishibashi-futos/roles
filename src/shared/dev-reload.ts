import type { Hono } from "hono";

const DEV_SERVER_BOOT_ID = crypto.randomUUID();

export const isDevelopmentRuntime = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => env.NODE_ENV !== "production";

export const registerDevReloadRoutes = (app: Hono) => {
  if (!isDevelopmentRuntime()) {
    return;
  }

  app.get("/api/dev/server-state", (c) => {
    c.header("Cache-Control", "no-store, no-cache, must-revalidate");
    c.header("Pragma", "no-cache");

    return c.json({
      bootId: DEV_SERVER_BOOT_ID,
    });
  });
};
