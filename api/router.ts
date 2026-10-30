import { createRouter, publicQuery } from "./middleware";
import { statsRouter } from "./statsRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  stats: statsRouter,
});

export type AppRouter = typeof appRouter;
