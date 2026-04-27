import { QueryClient } from "@tanstack/react-query";

// 1. Query client create ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export const queryClient = createQueryClient();
