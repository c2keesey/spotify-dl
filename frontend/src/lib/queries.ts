import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false }, mutations: { retry: 0 } },
});

export const qk = {
  config: ["config"] as const,
  jobs: ["jobs"] as const,
  library: (path: string) => ["library", path] as const,
  crons: ["crons"] as const,
  djStatus: (path: string) => ["djStatus", path] as const,
  djTracks: (f: object) => ["djTracks", f] as const,
  djCompat: (ids: string[]) => ["djCompat", ids] as const,
};
