#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { RuntimeEventBus } from "../dist/events/runtimeEventBus.js";
import { createRequestHandler } from "../dist/http/createRequestHandler.js";
import { HttpError } from "../dist/http/httpError.js";
import { readJson } from "../dist/http/request.js";
import { applyCors, writeHtml, writeJson } from "../dist/http/response.js";
import { taskIDFromActionPath } from "../dist/http/taskPath.js";

class FakeResponse extends EventEmitter {
  headers = new Map();
  status = undefined;
  body = "";

  setHeader(name, value) {
    this.headers.set(name, value);
  }

  writeHead(status, headers = {}) {
    this.status = status;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    return this;
  }

  write(value) {
    this.body += value;
    return true;
  }

  end(value = "") {
    this.body += value;
    return this;
  }
}

assert.equal(taskIDFromActionPath("/tasks/task-1/run-validation", "run-validation"), "task-1");
assert.equal(taskIDFromActionPath("/tasks/task-1/run-validation/extra", "run-validation"), undefined);
assert.equal(taskIDFromActionPath("/projects/task-1/run-validation", "run-validation"), undefined);

const httpError = new HttpError(409, "conflict");
assert.equal(httpError.status, 409);
assert.equal(httpError.message, "conflict");

assert.deepEqual(await readJson(Readable.from([])), {});
assert.deepEqual(await readJson(Readable.from([Buffer.from('{"ok":true}')])), { ok: true });
await assert.rejects(() => readJson(Readable.from([Buffer.from("{bad")])), SyntaxError);

const jsonResponse = new FakeResponse();
applyCors(jsonResponse);
writeJson(jsonResponse, 201, { id: "task-1" });
assert.equal(jsonResponse.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1");
assert.equal(jsonResponse.status, 201);
assert.equal(jsonResponse.headers.get("Content-Type"), "application/json");
assert.deepEqual(JSON.parse(jsonResponse.body), { id: "task-1" });

const htmlResponse = new FakeResponse();
writeHtml(htmlResponse, 200, "<p>Forge</p>");
assert.equal(htmlResponse.headers.get("Content-Type"), "text/html; charset=utf-8");
assert.equal(htmlResponse.body, "<p>Forge</p>");

const eventBus = new RuntimeEventBus();
const eventResponse = new FakeResponse();
eventBus.openEventStream(eventResponse);
assert.equal(eventResponse.status, 200);
assert.match(eventResponse.body, /event: connected/);
eventBus.emit("task.created", { taskID: "task-1" });
assert.match(eventResponse.body, /event: task\.created/);
assert.match(eventResponse.body, /"taskID":"task-1"/);
eventResponse.emit("close");
const bodyAfterClose = eventResponse.body;
eventBus.emit("task.updated", { taskID: "task-1" });
assert.equal(eventResponse.body, bodyAfterClose);

let handled = false;
const preflightHandler = createRequestHandler({
  observerMode: true,
  async handle() { handled = true; }
});
const preflightResponse = new FakeResponse();
await preflightHandler(fakeRequest("OPTIONS", "/tasks"), preflightResponse);
assert.equal(preflightResponse.status, 204);
assert.equal(handled, false);

const observerResponse = new FakeResponse();
await preflightHandler(fakeRequest("POST", "/tasks"), observerResponse);
assert.equal(observerResponse.status, 403);
assert.equal(JSON.parse(observerResponse.body).error, "observer_read_only");
assert.equal(handled, false);

const domainErrorHandler = createRequestHandler({
  observerMode: false,
  async handle() { throw new HttpError(409, "stale review"); }
});
const domainErrorResponse = new FakeResponse();
await domainErrorHandler(fakeRequest("GET", "/git/status"), domainErrorResponse);
assert.equal(domainErrorResponse.status, 409);
assert.deepEqual(JSON.parse(domainErrorResponse.body), { error: "runtime_error", message: "stale review" });

const unexpectedErrorHandler = createRequestHandler({
  observerMode: false,
  async handle() { throw new Error("unexpected"); }
});
const unexpectedErrorResponse = new FakeResponse();
await unexpectedErrorHandler(fakeRequest("GET", "/health"), unexpectedErrorResponse);
assert.equal(unexpectedErrorResponse.status, 500);
assert.equal(JSON.parse(unexpectedErrorResponse.body).message, "unexpected");

const errorToken = ["ghp", "httperror1234567890abcdef"].join("_");
const secretErrorHandler = createRequestHandler({
  observerMode: false,
  async handle() { throw new HttpError(400, `Unsupported provider ${errorToken}`); }
});
const secretErrorResponse = new FakeResponse();
await secretErrorHandler(fakeRequest("POST", "/settings/model-provider"), secretErrorResponse);
assert.equal(secretErrorResponse.status, 400);
assert(!secretErrorResponse.body.includes(errorToken));
assert.match(JSON.parse(secretErrorResponse.body).message, /\[REDACTED\]/);

console.log("HTTP primitives test passed: 32 assertions.");

function fakeRequest(method, url) {
  const request = Readable.from([]);
  request.method = method;
  request.url = url;
  request.headers = { host: "localhost" };
  return request;
}
