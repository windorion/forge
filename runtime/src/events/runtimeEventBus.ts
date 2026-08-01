import type { ServerResponse } from "node:http";

export class RuntimeEventBus {
  readonly #clients = new Set<ServerResponse>();

  openEventStream(response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    response.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    this.#clients.add(response);

    response.on("close", () => {
      this.#clients.delete(response);
    });
  }

  emit(type: string, data: Record<string, unknown>): void {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.#clients) {
      client.write(payload);
    }
  }

  close(): void {
    for (const client of this.#clients) client.end();
    this.#clients.clear();
  }
}
