import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { URL } from "node:url";

import { safeErrorMessage } from "../security/secretRedaction.js";
import { HttpError } from "./httpError.js";
import { applyCors, writeJson } from "./response.js";

export type RuntimeRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
) => Promise<void>;

export interface RequestHandlerOptions {
  observerMode: boolean;
  handle: RuntimeRouteHandler;
}

export function createRequestHandler(options: RequestHandlerOptions): RequestListener {
  return async (request, response) => {
    applyCors(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    try {
      if (options.observerMode && request.method !== "GET") {
        writeJson(response, 403, {
          error: "observer_read_only",
          message: "Observer runtime accepts read-only GET requests only. Focus the repository before taking an action."
        });
        return;
      }

      await options.handle(request, response, url);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      writeJson(response, status, {
        error: "runtime_error",
        message: safeErrorMessage(error)
      });
    }
  };
}
