import type { ServerResponse } from "node:http";

export function applyCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

export function writeHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  response.end(body);
}
