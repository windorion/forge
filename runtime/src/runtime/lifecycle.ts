import type { Server } from "node:http";

export interface RuntimeLifecycleOptions {
  server: Server;
  port: number;
  observerMode: boolean;
  stuckSweepIntervalMs: number;
  beforeListenPrimary?: () => void;
  onListening: () => void;
  onListeningPrimary?: () => void;
  sweepStuckWork?: () => void;
  onShutdown: () => void;
}

export function startRuntimeLifecycle(options: RuntimeLifecycleOptions): void {
  if (!options.observerMode) {
    options.beforeListenPrimary?.();
    if (options.sweepStuckWork && options.stuckSweepIntervalMs > 0) {
      setInterval(() => {
        try {
          options.sweepStuckWork?.();
        } catch (error) {
          console.error(`Stuck-work sweep failed: ${(error as Error).message}`);
        }
      }, options.stuckSweepIntervalMs).unref();
    }
  }

  options.server.listen(options.port, "127.0.0.1", () => {
    options.onListening();
    if (!options.observerMode) options.onListeningPrimary?.();
  });

  let shuttingDown = false;
  const shutdown = (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    options.onShutdown();
    process.exit(exitCode);
  };

  process.once("SIGINT", () => shutdown(130));
  process.once("SIGTERM", () => shutdown(143));
}
