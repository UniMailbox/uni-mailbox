import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { captureBrowserError } from "../lib/sentry";

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => captureBrowserError(error, "query"),
    }),
    mutationCache: new MutationCache({
      onError: (error) => captureBrowserError(error, "mutation"),
    }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}
