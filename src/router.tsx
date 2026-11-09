import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Start loading a page's code when the pointer rests on its link, so it opens at once.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
