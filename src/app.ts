import { Hono } from "hono";
import { registerPhase2Routes } from "./features/phase2/routes";
import { registerPhase3Routes } from "./features/phase3/routes";
import { registerPhase1Routes } from "./features/phase1/routes";
import type { CreateRuntimeOptions } from "./runtime";
import { createRuntime } from "./runtime";
import { registerDevReloadRoutes } from "./shared/dev-reload";
import { registerStaticAssetRoutes } from "./shared/static-assets";
export type CreateAppOptions = CreateRuntimeOptions;

export const createApp = (options: CreateAppOptions = {}) => {
  const app = new Hono();
  registerStaticAssetRoutes(app);
  registerDevReloadRoutes(app);
  const { repository, phase1Service, phase2Service, phase3Service } =
    createRuntime(options);

  registerPhase1Routes(app, {
    service: phase1Service,
    repository,
  });
  registerPhase2Routes(app, {
    service: phase2Service,
    repository,
  });
  registerPhase3Routes(app, {
    service: phase3Service,
    repository,
  });

  return app;
};

const app = createApp();

export default app;
