export function renderRuntimeHome(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Forge Runtime</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f5f2;
      color: #171717;
    }
    main {
      max-width: 760px;
      margin: 72px auto;
      padding: 0 28px;
    }
    h1 {
      font-size: 34px;
      margin-bottom: 8px;
      letter-spacing: 0;
    }
    p {
      color: #555;
      line-height: 1.6;
    }
    code {
      background: #e9e6df;
      border-radius: 6px;
      padding: 2px 6px;
    }
    ul {
      margin-top: 24px;
      padding-left: 20px;
      line-height: 1.8;
    }
    a {
      color: #1756a9;
    }
  </style>
</head>
<body>
  <main>
    <h1>Forge Runtime is running</h1>
    <p>This local service powers the Forge macOS app. The full product UI runs through <code>swift run ForgeApp</code>.</p>
    <ul>
      <li><a href="/health">GET /health</a></li>
      <li><a href="/tasks">GET /tasks</a></li>
      <li><a href="/git/status">GET /git/status</a></li>
      <li><a href="/git/conflicts">GET /git/conflicts</a></li>
      <li><code>GET /git/diff?path=README.md</code></li>
      <li><a href="/git/branch-preview">GET /git/branch-preview</a></li>
      <li><code>POST /git/branch</code></li>
      <li><a href="/git/branch-publish-preview">GET /git/branch-publish-preview</a></li>
      <li><code>POST /git/branch-publish</code></li>
      <li><a href="/git/commit-preview">GET /git/commit-preview</a></li>
      <li><code>POST /git/commit</code></li>
      <li><a href="/git/push-preview">GET /git/push-preview</a></li>
      <li><code>POST /git/push</code></li>
      <li><a href="/git/pr-preview">GET /git/pr-preview</a></li>
      <li><code>POST /git/pr-publish</code></li>
      <li><code>POST /git/pr-status</code></li>
      <li><code>POST /maintenance/recover-stuck</code></li>
      <li><a href="/validation-presets">GET /validation-presets</a></li>
      <li><a href="/settings/model-provider">GET /settings/model-provider</a></li>
      <li><code>POST /settings/model-provider</code></li>
      <li><code>POST /tasks</code></li>
      <li><code>POST /tasks/:taskID/messages</code></li>
      <li><code>POST /tasks/:taskID/generate-plan-revision</code></li>
      <li><code>POST /tasks/:taskID/approve-plan</code></li>
      <li><code>POST /tasks/:taskID/approve-plan-and-run</code></li>
      <li><code>POST /tasks/:taskID/run-agent-step</code></li>
      <li><code>POST /tasks/:taskID/run-agent-loop</code></li>
      <li><code>POST /tasks/:taskID/pause-agent-loop</code></li>
      <li><code>POST /tasks/:taskID/abort-agent-loop</code></li>
      <li><code>POST /tasks/:taskID/resume-agent-loop</code></li>
      <li><code>POST /tasks/:taskID/generate-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/revise-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/generate-validation-repair-proposal</code></li>
      <li><code>POST /tasks/:taskID/validate-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/apply-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/rollback-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/reject-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/approve-validation-preset</code></li>
      <li><code>POST /tasks/:taskID/run-validation</code></li>
      <li><code>POST /tasks/:taskID/run-task-command</code></li>
      <li><code>POST /tasks/:taskID/rerun-repair-command</code></li>
      <li><code>POST /tasks/:taskID/cancel-task-command</code></li>
      <li><code>GET /events</code></li>
    </ul>
  </main>
</body>
</html>`;
}
