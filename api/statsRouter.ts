import { createRouter, publicQuery } from "./middleware";
import { recentWinners } from "./queries/matches";

export const statsRouter = createRouter({
  recentWinners: publicQuery.query(() => recentWinners()),
});
