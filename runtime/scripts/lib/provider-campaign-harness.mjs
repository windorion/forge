import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export async function createFixtureRepository(repoRoot, files) {
  await mkdir(repoRoot, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(repoRoot, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  runGit(["init", "--quiet"], repoRoot);
  runGit(["add", "."], repoRoot);
  runGit([
    "-c", "user.name=Forge Provider Reliability",
    "-c", "user.email=forge-provider-reliability@example.invalid",
    "commit", "--quiet", "-m", "Initial provider fixture"
  ], repoRoot);
}

export async function startMockOpenAI({ port, responder }) {
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/responses") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    try {
      const raw = await readRequestBody(request);
      const body = JSON.parse(raw);
      const entry = {
        name: body?.text?.format?.name ?? "unknown",
        authorization: request.headers.authorization ?? "",
        contentType: request.headers["content-type"] ?? "",
        body
      };
      requests.push(entry);
      const output = await responder(entry, requests);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(output) }]
        }]
      }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  return {
    server,
    requests,
    baseURL: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  };
}

export async function startProviderRuntime({ runtimeRoot, caseRoot, repoRoot, port, openAIBaseURL }) {
  const baseURL = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_REPO_ROOT: repoRoot,
      FORGE_RUNTIME_DB_PATH: join(caseRoot, "forge.sqlite"),
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: join(caseRoot, "model-provider.json"),
      FORGE_TASK_QUEUE_SETTINGS_PATH: join(caseRoot, "task-queue.json"),
      FORGE_VALIDATION_PRESET_CONFIG_PATH: join(caseRoot, "validation-presets.json"),
      FORGE_MODEL_PROVIDER: "openai",
      FORGE_MODEL_NAME: "mock-openai-provider-reliability",
      FORGE_OPENAI_BASE_URL: openAIBaseURL,
      FORGE_OPENAI_TIMEOUT_MS: "10000",
      FORGE_OPENAI_MAX_OUTPUT_TOKENS: "4000",
      FORGE_STUCK_SWEEP_INTERVAL_MS: "0",
      OPENAI_API_KEY: "provider-reliability-secret"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  let exited = false;
  child.stdout.on("data", (chunk) => { output = boundedOutput(output, chunk); });
  child.stderr.on("data", (chunk) => { output = boundedOutput(output, chunk); });
  child.on("exit", () => { exited = true; });

  const request = async (method, path, body) => {
    const response = await fetch(`${baseURL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 1800)}`);
    }
    return text ? JSON.parse(text) : {};
  };
  const handle = {
    child,
    get output() { return output; },
    get exited() { return exited; },
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    async waitForTask(taskID, predicate, label, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      let lastTask;
      while (Date.now() < deadline) {
        const response = await request("GET", "/tasks");
        lastTask = response.tasks.find((candidate) => candidate.id === taskID);
        if (lastTask && predicate(lastTask)) return lastTask;
        await sleep(100);
      }
      throw new Error(`Timed out waiting for ${label}. Last task: ${JSON.stringify(summarizeTask(lastTask))}`);
    },
    async stop() {
      if (exited) return;
      child.kill("SIGTERM");
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (exited) return;
        await sleep(100);
      }
      child.kill("SIGKILL");
    }
  };

  const deadline = Date.now() + 10_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Runtime exited before health check.\n${output}`);
    try {
      const health = await handle.get("/health");
      if (
        health.ok &&
        health.workspace?.repoRoot === repoRoot &&
        health.modelProviderConfiguration?.provider?.id === "openai" &&
        health.modelProviderConfiguration?.status === "Ready"
      ) {
        return handle;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  await handle.stop();
  throw new Error(`Runtime health timed out: ${lastError}\n${output}`);
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", rejectBody);
  });
}

function boundedOutput(current, chunk) {
  const next = current + chunk.toString("utf8");
  return next.length > 16_000 ? next.slice(next.length - 16_000) : next;
}

function summarizeTask(task) {
  if (!task) return undefined;
  return {
    id: task.id,
    status: task.status,
    currentPhase: task.currentPhase,
    planRevisions: task.planRevisions?.length ?? 0,
    editProposalStatus: task.editProposal?.status,
    lastCommandStatus: task.taskCommandRuns?.at(-1)?.status,
    lastEvent: task.events?.at(-1)?.type
  };
}
