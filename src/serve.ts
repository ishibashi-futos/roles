import { serve } from "bun";
import app from "./app";

export const startServer = (port = 3000) => {
  serve({
    fetch: app.fetch,
    port,
  });

  console.log(`roles server listening on http://localhost:${port}`);
};
