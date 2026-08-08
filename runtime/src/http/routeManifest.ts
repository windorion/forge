export type RuntimeRouteMethod = "GET" | "POST" | "OPTIONS";

export interface RuntimeRouteContract {
  method: RuntimeRouteMethod;
  path: string;
  successStatus: number;
  availableInObserverMode: boolean;
}

const get = (path: string): RuntimeRouteContract => ({
  method: "GET",
  path,
  successStatus: 200,
  availableInObserverMode: true
});

const post = (path: string, successStatus = 200): RuntimeRouteContract => ({
  method: "POST",
  path,
  successStatus,
  availableInObserverMode: false
});

const options = (path: string): RuntimeRouteContract => ({
  method: "OPTIONS",
  path,
  successStatus: 204,
  availableInObserverMode: true
});

/**
 * Public HTTP surface of the runtime. Keep this list synchronized with the
 * request handler until route groups consume the manifest directly.
 */
export const runtimeRouteManifest: readonly RuntimeRouteContract[] = [
  options("/*"),
  get("/"),
  get("/health"),
  get("/tasks"),
  get("/tasks/:taskID/audit-export"),
  get("/index"),
  post("/index/rebuild"),
  get("/index/symbols"),
  get("/queue"),
  post("/queue/settings"),
  post("/queue/reorder"),
  post("/tasks/:taskID/remove-from-queue"),
  get("/git/status"),
  get("/git/diff"),
  get("/git/conflicts"),
  post("/git/conflicts/resolve"),
  get("/git/commit-preview"),
  get("/git/branch-preview"),
  post("/git/branch"),
  get("/git/branch-publish-preview"),
  post("/git/branch-publish"),
  post("/git/commit", 201),
  get("/git/push-preview"),
  post("/git/push"),
  get("/git/pr-preview"),
  post("/git/pr-publish"),
  post("/maintenance/recover-stuck"),
  post("/git/pr-status"),
  get("/validation-presets"),
  get("/settings/model-provider"),
  post("/settings/model-provider"),
  get("/tasks/:taskID/validation-permissions"),
  post("/tasks/:taskID/messages", 201),
  post("/tasks/:taskID/generate-plan-revision"),
  post("/tasks", 201),
  post("/tasks/:taskID/approve-plan"),
  post("/tasks/:taskID/cancel"),
  post("/tasks/:taskID/approve-plan-and-run"),
  post("/tasks/:taskID/run-agent-step"),
  post("/tasks/:taskID/run-agent-loop"),
  post("/tasks/:taskID/pause-agent-loop"),
  post("/tasks/:taskID/abort-agent-loop"),
  post("/tasks/:taskID/resume-agent-loop"),
  post("/tasks/:taskID/generate-edit-proposal"),
  post("/tasks/:taskID/revise-edit-proposal"),
  post("/tasks/:taskID/generate-validation-repair-proposal"),
  post("/tasks/:taskID/validate-edit-proposal"),
  post("/tasks/:taskID/review-edit-proposal-file"),
  post("/tasks/:taskID/apply-edit-proposal"),
  post("/tasks/:taskID/rollback-edit-proposal"),
  post("/tasks/:taskID/reject-edit-proposal"),
  post("/tasks/:taskID/approve-validation-preset"),
  post("/tasks/:taskID/run-validation"),
  post("/tasks/:taskID/run-task-command"),
  post("/tasks/:taskID/rerun-repair-command"),
  post("/tasks/:taskID/cancel-task-command"),
  get("/events")
];
