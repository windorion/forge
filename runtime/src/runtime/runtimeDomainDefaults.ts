import type { AgentState, ForgeTask, PlanStep } from "../types.js";
import type {
  InternalValidationCommand,
  InternalValidationPreset
} from "../validation/validationServiceTypes.js";

export function createRepositoryDomainDefaults() {
  const repositoryIgnoredDirectories = new Set([
    ".build", ".forge", ".git", ".swiftpm", "DerivedData", "dist", "node_modules"
  ]);
  const repositoryIgnoredFileNames = new Set([".DS_Store", "package-lock.json"]);
  const editProposalBlockedFileNames = new Set([
    ".env", ".env.local", ".env.development", ".env.production",
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Package.resolved"
  ]);
  const repositoryContextExtensions = new Set([
    ".md", ".ts", ".tsx", ".js", ".jsx", ".json", ".swift", ".sh", ".yml", ".yaml", ".toml"
  ]);
  const editProposalEditableExtensions = new Set([
    ...repositoryContextExtensions,
    ".c", ".cc", ".cpp", ".cs", ".css", ".cts", ".go", ".h", ".hpp", ".html",
    ".java", ".kt", ".kts", ".m", ".mjs", ".mm", ".mts", ".py", ".rb", ".rs"
  ]);
  const editProposalEditableFileNames = new Set([
    "Dockerfile", "Makefile", "Package.swift", "Podfile", "Rakefile"
  ]);
  const repositoryImportantFiles = [
    "README.md", "AGENTS.md", "docs/v0_scope.md", "docs/development.md",
    "docs/runtime_architecture.md", "docs/model_providers.md", "docs/local_first.md",
    "runtime/src/server.ts", "runtime/src/modelProvider.ts", "runtime/src/types.ts", "Package.swift"
  ];
  const repositorySearchStopWords = new Set([
    "about", "after", "again", "agent", "because", "before", "build", "code", "continue",
    "current", "doing", "done", "files", "forge", "from", "have", "into", "like", "local",
    "make", "next", "only", "plan", "project", "repo", "task", "that", "this", "what", "with", "work"
  ]);
  const chineseIntentSearchTerms: Array<[string, string[]]> = [
    ["模型", ["model", "provider", "intent"]], ["意图", ["intent", "brief", "objective"]],
    ["上下文", ["context", "repository", "file"]], ["搜索", ["search", "context", "file"]],
    ["仓库", ["repository", "repo", "context"]], ["代码", ["code", "edit", "diff"]],
    ["聊天", ["conversation", "message", "intent"]], ["对话", ["conversation", "message", "intent"]],
    ["验证", ["validation", "preset", "command"]], ["测试", ["test", "validation", "command"]],
    ["权限", ["permission", "approval", "risk"]], ["审批", ["approval", "review", "permission"]],
    ["本地", ["local", "runtime", "context"]], ["执行", ["execution", "proposal", "agent"]],
    ["修改", ["edit", "proposal", "diff"]], ["文件", ["file", "context", "read"]],
    ["不是", ["mimic", "deterministic", "provider"]], ["模拟", ["mimic", "deterministic", "provider"]]
  ];

  return {
    repositoryIgnoredDirectories,
    repositoryIgnoredFileNames,
    editProposalBlockedFileNames,
    repositoryContextExtensions,
    editProposalEditableExtensions,
    editProposalEditableFileNames,
    repositoryImportantFiles,
    repositorySearchStopWords,
    chineseIntentSearchTerms
  };
}

export function createValidationDomainDefaults(options: {
  enableSmokeCommands: boolean;
  validateChangedFiles: (task: ForgeTask) => Promise<string>;
  validateAppliedProposalRecorded: (task: ForgeTask) => Promise<string>;
  validateReadyProposalValidation: (task: ForgeTask) => Promise<string>;
}) {
  const builtInValidationCommands: InternalValidationCommand[] = [
    builtIn("changed-files-exist", "Changed files exist", "forge:changed-files-exist", options.validateChangedFiles),
    builtIn(
      "applied-proposal-recorded",
      "Applied proposal recorded",
      "forge:applied-proposal-recorded",
      options.validateAppliedProposalRecorded
    ),
    builtIn(
      "ready-validation-retained",
      "Ready validation retained",
      "forge:ready-validation-retained",
      options.validateReadyProposalValidation
    )
  ];
  const smokeTaskValidationCommands: InternalValidationCommand[] = options.enableSmokeCommands
    ? [{
        id: "smoke-long-task-command",
        name: "Smoke long task command",
        command: "node -e \"setTimeout(() => console.log('forge smoke long command done'), 5000)\"",
        kind: "ProjectCommand",
        riskLevel: "Medium",
        cwd: "runtime",
        executable: "node",
        args: ["-e", "setTimeout(() => console.log('forge smoke long command done'), 5000)"]
      }]
    : [];
  const projectValidationCommands: InternalValidationCommand[] = [
    projectCommand("runtime-npm-check", "Runtime type-check", "npm run check", "npm", ["run", "check"], "runtime"),
    projectCommand("runtime-npm-build", "Runtime build", "npm run build", "npm", ["run", "build"], "runtime"),
    projectCommand("macos-swift-build", "macOS SwiftPM build", "swift build", "swift", ["build"]),
    ...smokeTaskValidationCommands
  ];
  const validationCommandCatalog = new Map(
    [...builtInValidationCommands, ...projectValidationCommands].map((command) => [command.id, command])
  );
  const builtInValidationPresets: InternalValidationPreset[] = [
    {
      id: "forge-post-apply",
      name: "Forge Post-Apply Checks",
      description: "Built-in checks that confirm the applied proposal and changed files are still auditable.",
      source: "BuiltIn",
      riskLevel: "Low",
      requiresApproval: false,
      commands: builtInValidationCommands
    },
    {
      id: "runtime-typescript",
      name: "Runtime TypeScript Checks",
      description: "Approved project checks for the local TypeScript runtime: type-check and build.",
      source: "BuiltIn",
      riskLevel: "Medium",
      requiresApproval: true,
      commands: projectValidationCommands.filter((command) => command.id.startsWith("runtime-"))
    },
    {
      id: "macos-swiftpm",
      name: "macOS SwiftPM Build",
      description: "Approved project check for the native macOS SwiftPM app: swift build from the repository root.",
      source: "BuiltIn",
      riskLevel: "Medium",
      requiresApproval: true,
      commands: projectValidationCommands.filter((command) => command.id === "macos-swift-build")
    },
    ...(options.enableSmokeCommands ? [{
      id: "smoke-task-commands",
      name: "Smoke Task Commands",
      description: "Test-only long-running task command used by runtime smoke coverage.",
      source: "BuiltIn" as const,
      riskLevel: "Medium" as const,
      requiresApproval: true,
      commands: smokeTaskValidationCommands
    }] : [])
  ];
  return { validationCommandCatalog, builtInValidationPresets };
}

export function createTaskDomainDefaults(): { defaultAgents: AgentState[]; defaultPlanSteps: PlanStep[] } {
  return {
    defaultAgents: [
      { role: "Manager", status: "Active", summary: "Owns task lifecycle and constraints" },
      { role: "Planner", status: "Ready", summary: "Preparing the first implementation plan" },
      { role: "Coder", status: "Idle", summary: "Waiting for approved plan" },
      { role: "Tester", status: "Idle", summary: "Waiting for validation command" },
      { role: "Reviewer", status: "Idle", summary: "Waiting for diff" }
    ],
    defaultPlanSteps: [
      { id: "understand-objective", title: "Understand task objective", status: "Active", summary: "Parse the user request and preserve constraints." },
      { id: "build-context", title: "Build repository context", status: "Pending", summary: "Inspect project memory and local repository signals." },
      { id: "draft-plan", title: "Draft implementation plan", status: "Pending", summary: "Turn context into a reviewable plan." },
      { id: "request-review", title: "Request human review", status: "Pending", summary: "Pause before code changes." }
    ]
  };
}

function builtIn(
  id: string,
  name: string,
  command: string,
  executeBuiltIn: (task: ForgeTask) => Promise<string>
): InternalValidationCommand {
  return { id, name, command, kind: "BuiltIn", riskLevel: "Low", executeBuiltIn };
}

function projectCommand(
  id: string,
  name: string,
  command: string,
  executable: string,
  args: string[],
  cwd?: string
): InternalValidationCommand {
  return { id, name, command, kind: "ProjectCommand", riskLevel: "Medium", cwd, executable, args };
}
