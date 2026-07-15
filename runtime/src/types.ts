export type TaskStatus =
  | "Created"
  | "Planning"
  | "Plan Review"
  | "Running"
  | "Testing"
  | "Human Review"
  | "Completed"
  | "Failed";

export interface AgentState {
  role: "Manager" | "Planner" | "Coder" | "Tester" | "Reviewer";
  status: "Idle" | "Ready" | "Active" | "Blocked" | "Done";
  summary: string;
}

export interface RuntimeEvent {
  type: string;
  message: string;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  action:
    | "Approve Plan"
    | "Apply Edit Proposal"
    | "Rollback Edit Proposal"
    | "Reject Edit Proposal"
    | "Review Edit Proposal File"
    | "Approve Validation Preset"
    | "Cancel Task Command"
    | "Pause Agent Loop"
    | "Abort Agent Loop"
    | "Create Git Commit"
    | "Push Git Branch"
    | "Create Git Branch"
    | "Switch Git Branch"
    | "Publish Git Branch";
  decision: "Approved" | "Rejected";
  summary: string;
  decidedAt: string;
  targetID?: string;
  userNote?: string;
}

export interface PlanStep {
  id: string;
  title: string;
  status: "Pending" | "Active" | "Done" | "Blocked";
  summary: string;
}

export interface PlanRevision {
  id: string;
  provider: ModelProviderInfo;
  sourceMessageID?: string;
  intentSummary: string;
  summary: string;
  rationale: string;
  riskLevel: "Low" | "Medium" | "High";
  steps: PlanStep[];
  expectedFileAreas?: string[];
  validationPlan?: string[];
  riskNotes?: string[];
  estimatedMinutes?: number;
  estimatedCostUSD?: number;
  generatedAt: string;
}

export interface ModelProviderInfo {
  id: string;
  name: string;
  model: string;
  mode: "local" | "remote";
}

export interface ModelProviderConfigItem {
  id: string;
  label: string;
  value: string;
  isSecret: boolean;
}

export interface ModelProviderConfiguration {
  provider: ModelProviderInfo;
  configuredProviderID: string;
  status: "Ready" | "NeedsConfiguration" | "Unsupported";
  summary: string;
  issues: string[];
  settings: ModelProviderConfigItem[];
  sendsRemoteContext: boolean;
  remoteContextSummary?: string;
}

export interface ModelProviderRuntimeSettings {
  providerID: string;
  modelName?: string;
  openAIBaseURL?: string;
  openAITimeoutMs?: number;
  openAIMaxOutputTokens?: number;
  openAIAPIKey?: string;
}

export interface ModelProviderSettingsUpdateRequest {
  providerID?: string;
  modelName?: string;
  openAIBaseURL?: string;
  openAITimeoutMs?: number;
  openAIMaxOutputTokens?: number;
  openAIAPIKey?: string;
  clearOpenAIAPIKey?: boolean;
}

export interface IntentBrief {
  summary: string;
  constraints: string[];
  acceptanceCriteria: string[];
  openQuestions: string[];
  nextAction: string;
}

export interface TaskFileReference {
  id: string;
  requestedPath: string;
  path?: string;
  status: "Resolved" | "Missing" | "Blocked";
  summary: string;
  byteSize?: number;
  lineCount?: number;
  lineStart?: number;
  lineEnd?: number;
  detectedAt: string;
}

export interface TaskMessage {
  id: string;
  role: "User" | "Assistant";
  kind: "UserMessage" | "IntentBrief";
  content: string;
  createdAt: string;
  fileReferences: TaskFileReference[];
  provider?: ModelProviderInfo;
  intentBrief?: IntentBrief;
}

export interface ExecutionProposal {
  id: string;
  provider: ModelProviderInfo;
  summary: string;
  proposedActions: string[];
  contextFiles?: ContextFile[];
  toolEvidence?: string[];
  riskLevel: "Low" | "Medium" | "High";
  generatedAt: string;
}

export type AgentRunStepAction =
  | "InspectRepository"
  | "GenerateEditProposal"
  | "RunTaskCommand"
  | "GenerateValidationRepairProposal"
  | "RerunRepairCommand"
  | "WaitForHumanReview"
  | "RequestPlanApproval";

export type RepositoryInspectionSearchMode = "Text" | "Symbol";

export interface AgentRunStepDecision {
  action: AgentRunStepAction;
  summary: string;
  rationale: string;
  commandID?: string;
  commandRerunEvidenceID?: string;
  searchTerms?: string[];
  readPaths?: string[];
  searchMode?: RepositoryInspectionSearchMode;
  providerAttemptCount?: number;
  providerOutputRecovered?: boolean;
  providerAttemptErrors?: string[];
}

export interface AgentRunStep {
  id: string;
  provider: ModelProviderInfo;
  loopID?: string;
  action: AgentRunStepAction;
  status: "Running" | "Completed" | "Blocked" | "Failed";
  summary: string;
  rationale: string;
  commandID?: string;
  commandName?: string;
  commandRerunEvidenceID?: string;
  searchTerms?: string[];
  readPaths?: string[];
  contextFilePaths?: string[];
  inspectionRequestFingerprint?: string;
  inspectionBudgetSummary?: string;
  inspectionSearchMode?: RepositoryInspectionSearchMode;
  inspectionSearchEngine?: string;
  inspectionQuality?: "Strong" | "Partial" | "Weak" | "NoNewContext";
  inspectionQualitySummary?: string;
  inspectionMatchCount?: number;
  inspectionMatchedFileCount?: number;
  inspectionNewContextFileCount?: number;
  inspectionContextByteCount?: number;
  inspectionQueryCoverage?: number;
  providerAttemptCount?: number;
  providerOutputRecovered?: boolean;
  providerAttemptErrors?: string[];
  targetID?: string;
  resultSummary?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export type AgentRunLoopStopReason =
  | "HumanReviewRequired"
  | "CommandPassed"
  | "RepairVerified"
  | "StepBlocked"
  | "StepFailed"
  | "MaxStepsReached"
  | "TaskBusy"
  | "NoProgress"
  | "UserPaused"
  | "UserAborted"
  | "RuntimeRestarted";

export interface AgentRunLoop {
  id: string;
  provider: ModelProviderInfo;
  status: "Running" | "Completed" | "Paused" | "Aborted" | "Failed";
  maxSteps: number;
  stepsRun: number;
  stepIDs: string[];
  preferredCommandID?: string;
  resumedFromLoopID?: string;
  resumedByLoopID?: string;
  controlState?: "PauseRequested" | "AbortRequested";
  controlRequestedAt?: string;
  controlNote?: string;
  stopReason?: AgentRunLoopStopReason;
  summary: string;
  startedAt: string;
  completedAt?: string;
}

export interface ProposedFileChange {
  id: string;
  path: string;
  changeType: "Create" | "Modify" | "Delete";
  rationale: string;
  diffPreview: string;
  applyOperation?: ProposedFileOperation;
}

export interface AppendTextOperation {
  kind: "AppendText";
  text: string;
}

export interface ReplaceTextOperation {
  kind: "ReplaceText";
  findText: string;
  replaceWith: string;
}

export interface PatchTextHunk {
  findText: string;
  replaceWith: string;
}

export interface PatchTextOperation {
  kind: "PatchText";
  hunks: PatchTextHunk[];
}

export interface UnifiedDiffOperation {
  kind: "UnifiedDiff";
  patch: string;
}

export interface CreateFileOperation {
  kind: "CreateFile";
  content: string;
}

export interface DeleteFileOperation {
  kind: "DeleteFile";
}

export interface PreviewOnlyOperation {
  kind: "PreviewOnly";
}

export type ProposedFileOperation =
  | AppendTextOperation
  | ReplaceTextOperation
  | PatchTextOperation
  | UnifiedDiffOperation
  | CreateFileOperation
  | DeleteFileOperation
  | PreviewOnlyOperation;

export interface EditProposalDecisionRequest {
  note?: string;
}

export interface EditProposalFileReviewRequest {
  fileChangeID: string;
  decision: "Approved" | "ChangesRequested";
  note?: string;
}

export interface EditProposalFileDecision {
  fileChangeID: string;
  path: string;
  decision: "Approved" | "ChangesRequested";
  note?: string;
  decidedAt: string;
}

export type EditProposalValidationStatus = "Ready" | "Blocked";

export interface FileChangeValidation {
  id: string;
  path: string;
  status: EditProposalValidationStatus;
  summary: string;
  checks: string[];
}

export interface EditProposalValidation {
  status: EditProposalValidationStatus;
  summary: string;
  checkedAt: string;
  fileResults: FileChangeValidation[];
}

export interface AppliedFileChange {
  path: string;
  operationKind: ProposedFileOperation["kind"];
  rollbackKind: "RestorePreviousContent" | "DeleteCreatedFile" | "RestoreDeletedFile";
  rollbackSummary: string;
  appliedAt: string;
  proposalFileChangeID?: string;
  beforeSha256?: string;
  afterSha256?: string;
  beforeByteLength?: number;
  afterByteLength?: number;
  rollbackSnapshotPath?: string;
  applyVerifiedAt?: string;
  rolledBackAt?: string;
  rollbackVerifiedAt?: string;
}

export interface EditProposalFileTransaction {
  id: string;
  kind: "Apply" | "Rollback";
  status: "Running" | "Completed" | "Recovered" | "RecoveryFailed";
  journalVersion?: 1;
  paths: string[];
  summary: string;
  startedAt: string;
  completedAt?: string;
  verifiedAt?: string;
  recoverySummary?: string;
}

export interface EditProposal {
  id: string;
  provider: ModelProviderInfo;
  sourceMessageID?: string;
  revisionOfID?: string;
  validationRepairBriefID?: string;
  revisionNumber: number;
  summary: string;
  fileChanges: ProposedFileChange[];
  riskLevel: "Low" | "Medium" | "High";
  status: "Proposed" | "Rejected" | "Superseded" | "Applied" | "RolledBack";
  generatedAt: string;
  decidedAt?: string;
  decisionNote?: string;
  requiresFileReview?: boolean;
  fileDecisions?: EditProposalFileDecision[];
  rolledBackAt?: string;
  rollbackNote?: string;
  validation?: EditProposalValidation;
  appliedFileChanges?: AppliedFileChange[];
  applyTransaction?: EditProposalFileTransaction;
  rollbackTransaction?: EditProposalFileTransaction;
}

export interface ToolCall {
  id: string;
  name: string;
  status: "Started" | "Completed" | "Failed";
  input: string;
  outputSummary: string;
  startedAt: string;
  endedAt?: string;
}

export interface ValidationCommandResult {
  id: string;
  name: string;
  command: string;
  kind: "BuiltIn" | "ProjectCommand";
  riskLevel: "Low" | "Medium" | "High";
  cwd?: string;
  status: "Running" | "Passed" | "Failed";
  outputSummary: string;
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
}

export interface TaskCommandOutputChunk {
  id: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
  createdAt: string;
}

export interface TaskCommandRun {
  id: string;
  commandID: string;
  name: string;
  command: string;
  kind: "BuiltIn" | "ProjectCommand";
  riskLevel: "Low" | "Medium" | "High";
  cwd?: string;
  presetID?: string;
  presetName?: string;
  status: "Running" | "Passed" | "Failed" | "Cancelled";
  outputSummary: string;
  outputChunks: TaskCommandOutputChunk[];
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
}

export interface CommandRerunEvidence {
  id: string;
  sourceTaskCommandRunID: string;
  validationRepairBriefID: string;
  repairProposalID: string;
  repairAppliedAt?: string;
  rerunTaskCommandRunID?: string;
  commandID: string;
  commandName: string;
  status: "Ready" | "Running" | "Passed" | "Failed" | "Cancelled";
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationRun {
  id: string;
  trigger: "PostApply" | "Manual";
  presetID: string;
  presetName: string;
  presetSource: "BuiltIn" | "Workspace";
  riskLevel: "Low" | "Medium" | "High";
  status: "Running" | "Passed" | "Failed";
  summary: string;
  startedAt: string;
  endedAt?: string;
  commands: ValidationCommandResult[];
}

export interface ValidationRepairBrief {
  id: string;
  provider: ModelProviderInfo;
  validationRunID?: string;
  taskCommandRunID?: string;
  source?: "ValidationRun" | "TaskCommandRun";
  sourceSummary?: string;
  summary: string;
  likelyCause: string;
  recommendedActions: string[];
  followUpPrompt: string;
  riskLevel: "Low" | "Medium" | "High";
  generatedAt: string;
}

export interface ValidationCommandDefinition {
  id: string;
  name: string;
  command: string;
  kind: "BuiltIn" | "ProjectCommand";
  riskLevel: "Low" | "Medium" | "High";
  cwd?: string;
  executionMode: "BuiltIn" | "SpawnNoShell";
  boundary: string;
}

export interface ValidationPreset {
  id: string;
  name: string;
  description: string;
  source: "BuiltIn" | "Workspace";
  riskLevel: "Low" | "Medium" | "High";
  requiresApproval: boolean;
  commands: ValidationCommandDefinition[];
}

export type ValidationPresetApprovalState = "NotRequired" | "NeedsApproval" | "Approved";
export type ValidationPresetExecutionState = "Blocked" | "NeedsApproval" | "Ready" | "Running";

export interface ValidationPermissionApproval {
  id: string;
  decidedAt: string;
  summary: string;
}

export interface ValidationPermissionLastRun {
  id: string;
  status: ValidationRun["status"];
  summary: string;
  startedAt: string;
  endedAt?: string;
}

export interface ValidationPresetPermission {
  preset: ValidationPreset;
  approvalState: ValidationPresetApprovalState;
  executionState: ValidationPresetExecutionState;
  canApprove: boolean;
  canRun: boolean;
  blockedReasons: string[];
  approval?: ValidationPermissionApproval;
  lastRun?: ValidationPermissionLastRun;
}

export interface TaskCommandPermissionLastRun {
  id: string;
  status: TaskCommandRun["status"];
  summary: string;
  startedAt: string;
  endedAt?: string;
}

export interface TaskCommandPermission {
  command: ValidationCommandDefinition;
  presetID: string;
  presetName: string;
  presetSource: ValidationPreset["source"];
  presetRiskLevel: ValidationPreset["riskLevel"];
  approvalState: ValidationPresetApprovalState;
  executionState: ValidationPresetExecutionState;
  canRun: boolean;
  blockedReasons: string[];
  approval?: ValidationPermissionApproval;
  lastRun?: TaskCommandPermissionLastRun;
}

export interface ValidationPermissionEnvelope {
  taskID: string;
  taskStatus: TaskStatus;
  currentPhase: string;
  permissions: ValidationPresetPermission[];
  taskCommands: TaskCommandPermission[];
}

export interface GitFileChange {
  path: string;
  status: "Added" | "Modified" | "Deleted" | "Renamed" | "Copied" | "Untracked" | "Unmerged" | "Unknown";
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  oldPath?: string;
  additions?: number;
  deletions?: number;
}

export interface GitStatusSnapshot {
  isRepository: boolean;
  root?: string;
  branch?: string;
  upstream?: string;
  head?: string;
  ahead?: number;
  behind?: number;
  isDirty: boolean;
  summary: string;
  generatedAt: string;
  changedFiles: GitFileChange[];
  error?: string;
}

export interface GitFileDiff {
  path: string;
  oldPath?: string;
  status?: GitFileChange["status"];
  generatedAt: string;
  diff: string;
  truncated: boolean;
  displayMode?: "SideBySide" | "Message";
  unavailableReason?: "Binary" | "TooLarge" | "NotRegularFile" | "NoTextualDiff" | "CommandFailed";
  byteCount?: number;
  lineCount?: number;
  appPreviewLineLimit: number;
  summary: string;
}

export interface GitConflictStage {
  stage: "Base" | "Ours" | "Theirs" | "Working";
  available: boolean;
  content?: string;
  byteCount: number;
  lineCount: number;
  unavailableReason?: "Missing" | "Binary" | "TooLarge" | "NotRegularFile" | "CommandFailed";
  summary: string;
}

export interface GitConflictFile {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  conflictHash: string;
  base: GitConflictStage;
  ours: GitConflictStage;
  theirs: GitConflictStage;
  working: GitConflictStage;
}

export interface GitConflictSnapshot {
  generatedAt: string;
  gitRoot: string;
  branch?: string;
  head?: string;
  operation: "Merge" | "Rebase" | "CherryPick" | "Unknown";
  oursLabel: string;
  theirsLabel: string;
  files: GitConflictFile[];
  summary: string;
  operationBoundary: string;
}

export interface GitConflictResolutionRequest {
  path: string;
  strategy: "Ours" | "Theirs" | "Manual";
  content?: string;
  expectedHead?: string;
  expectedConflictHash: string;
  confirmation: string;
  taskID?: string;
}

export interface GitConflictResolutionResult {
  generatedAt: string;
  path: string;
  strategy: GitConflictResolutionRequest["strategy"];
  status: "ResolvedAndStaged";
  staged: boolean;
  remainingConflicts: number;
  summary: string;
  operationBoundary: string;
}

export interface GitCommitRelatedTask {
  id: string;
  title: string;
  status: TaskStatus;
  currentPhase: string;
  summary: string;
}

export interface GitCommitPreview {
  generatedAt: string;
  readiness: "Ready" | "NeedsReview" | "Blocked";
  summary: string;
  expectedHead?: string;
  suggestedTitle: string;
  suggestedBody: string[];
  includedFiles: GitFileChange[];
  relatedTask?: GitCommitRelatedTask;
  validationSummary: string;
  validationCommands: string[];
  preflight?: GitCommitPreflight;
  riskNotes: string[];
  blockers: string[];
  operationBoundary: string;
}

export interface GitCommitPreflight {
  identityStatus: "Ready" | "Missing" | "Unknown";
  identitySummary: string;
  stagedFileCount: number;
  unstagedFileCount: number;
  untrackedFileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  filesWithoutStats: number;
  largeChangeSet: boolean;
  largeChangeSummary?: string;
  validationState: "Passed" | "Failed" | "Missing" | "Unknown";
  hookRiskSummary: string;
  pathLimit: number;
}

export interface GitCreateCommitRequest {
  taskID?: string;
  expectedHead: string;
  title: string;
  body?: string[];
  paths: string[];
  confirmation: "CreateLocalCommit";
}

export interface GitCreateCommitResult {
  generatedAt: string;
  commitHash: string;
  shortHash: string;
  branch?: string;
  summary: string;
  messageTitle: string;
  messageBody: string[];
  committedFiles: GitFileChange[];
  relatedTask?: GitCommitRelatedTask;
  operationBoundary: string;
}

export interface GitCommitToPush {
  hash: string;
  shortHash: string;
  title: string;
  authorDate?: string;
}

export interface GitPushPreview {
  generatedAt: string;
  readiness: "Ready" | "NeedsReview" | "Blocked";
  summary: string;
  preflight?: GitPushPreflight;
  expectedHead?: string;
  branch?: string;
  upstream?: string;
  remote?: string;
  remoteBranch?: string;
  ahead?: number;
  behind?: number;
  isDirty: boolean;
  commitsToPush: GitCommitToPush[];
  changedFiles: GitFileChange[];
  relatedTask?: GitCommitRelatedTask;
  riskNotes: string[];
  blockers: string[];
  operationBoundary: string;
}

export interface GitPushPreflight {
  branchStatus: "Ready" | "Detached" | "Missing";
  branchSummary: string;
  upstreamStatus: "Ready" | "Missing" | "Unpushed" | "Behind" | "NoAhead";
  upstreamSummary: string;
  remoteStatus: "Ready" | "Missing" | "Unknown";
  remoteSummary: string;
  commitStatus: "Ready" | "Empty" | "Truncated";
  commitSummary: string;
  worktreeStatus: "Clean" | "Dirty";
  worktreeSummary: string;
  actionReadiness: "Ready" | "NeedsReview" | "Blocked";
  actionReadinessSummary: string;
  failureRiskSummary: string;
}

export interface GitPushRequest {
  taskID?: string;
  expectedHead: string;
  expectedBranch: string;
  expectedUpstream: string;
  confirmation: "PushCurrentBranch";
}

export interface GitPushResult {
  generatedAt: string;
  branch: string;
  upstream: string;
  remote: string;
  remoteBranch: string;
  pushedCommits: GitCommitToPush[];
  summary: string;
  outputSummary: string;
  relatedTask?: GitCommitRelatedTask;
  operationBoundary: string;
}

export interface GitBranchPreview {
  generatedAt: string;
  readiness: "Ready" | "NeedsReview" | "Blocked";
  summary: string;
  preflight?: GitBranchPreflight;
  expectedHead?: string;
  currentBranch?: string;
  baseBranch: string;
  targetBranch: string;
  mode: "CreateBranch" | "SwitchBranch" | "AlreadyOnBranch";
  branchExists: boolean;
  isDirty: boolean;
  changedFiles: GitFileChange[];
  relatedTask?: GitCommitRelatedTask;
  riskNotes: string[];
  blockers: string[];
  operationBoundary: string;
}

export interface GitBranchPreflight {
  targetStatus: "Valid" | "Invalid" | "DefaultBranch" | "CurrentBranch";
  targetSummary: string;
  currentBranchStatus: "Ready" | "Detached" | "DefaultBranch" | "Unknown";
  currentBranchSummary: string;
  worktreeStatus: "Clean" | "DirtyAllowed" | "DirtyBlocked";
  worktreeSummary: string;
  existingBranchStatus: "NewLocal" | "ExistingLocal" | "CurrentBranch" | "RemoteCollision" | "Invalid";
  existingBranchSummary: string;
  actionReadiness: "Ready" | "NeedsReview" | "Blocked";
  actionReadinessSummary: string;
}

export interface GitBranchRequest {
  taskID?: string;
  expectedHead: string;
  expectedCurrentBranch: string;
  targetBranch: string;
  mode: "CreateBranch" | "SwitchBranch";
  confirmation: "CreateBranch" | "SwitchBranch";
}

export interface GitBranchResult {
  generatedAt: string;
  previousBranch?: string;
  branch: string;
  mode: "CreateBranch" | "SwitchBranch";
  summary: string;
  outputSummary: string;
  relatedTask?: GitCommitRelatedTask;
  operationBoundary: string;
}

export interface GitBranchPublishPreview {
  generatedAt: string;
  readiness: "Ready" | "NeedsReview" | "Blocked";
  summary: string;
  preflight?: GitBranchPublishPreflight;
  expectedHead?: string;
  branch?: string;
  baseBranch: string;
  remote?: string;
  remoteBranch?: string;
  upstream?: string;
  isDirty: boolean;
  commitsToPublish: GitCommitToPush[];
  changedFiles: GitFileChange[];
  relatedTask?: GitCommitRelatedTask;
  riskNotes: string[];
  blockers: string[];
  operationBoundary: string;
}

export interface GitBranchPublishPreflight {
  branchStatus: "Ready" | "Detached" | "DefaultBranch" | "AlreadyTracking" | "Missing";
  branchSummary: string;
  remoteStatus: "Ready" | "Missing" | "Unknown" | "RemoteCollision";
  remoteSummary: string;
  baseStatus: "Resolved" | "Missing";
  baseSummary: string;
  commitStatus: "Ready" | "Empty" | "Truncated";
  commitSummary: string;
  worktreeStatus: "Clean" | "Dirty";
  worktreeSummary: string;
  actionReadiness: "Ready" | "NeedsReview" | "Blocked";
  actionReadinessSummary: string;
  failureRiskSummary: string;
}

export interface GitBranchPublishRequest {
  taskID?: string;
  expectedHead: string;
  expectedBranch: string;
  remote: string;
  remoteBranch: string;
  confirmation: "PublishCurrentBranch";
}

export interface GitBranchPublishResult {
  generatedAt: string;
  branch: string;
  remote: string;
  remoteBranch: string;
  upstream: string;
  pushedCommits: GitCommitToPush[];
  summary: string;
  outputSummary: string;
  relatedTask?: GitCommitRelatedTask;
  operationBoundary: string;
}

export interface GitPullRequestPreview {
  generatedAt: string;
  readiness: "Ready" | "NeedsReview" | "Blocked";
  summary: string;
  preflight?: GitPullRequestPreflight;
  baseBranch: string;
  headBranch?: string;
  upstream?: string;
  remote?: string;
  remoteBranch?: string;
  suggestedBranchName: string;
  title: string;
  body: string[];
  testPlan: string[];
  commits: GitCommitToPush[];
  changedFiles: GitFileChange[];
  relatedTask?: GitCommitRelatedTask;
  riskNotes: string[];
  blockers: string[];
  operationBoundary: string;
}

export interface GitPullRequestPreflight {
  baseRefStatus: "Resolved" | "Missing";
  baseRefSummary: string;
  headBranchStatus: "Ready" | "Detached" | "DefaultBranch";
  headBranchSummary: string;
  upstreamStatus: "Ready" | "Missing" | "Unpushed" | "Behind";
  upstreamSummary: string;
  remoteStatus: "Ready" | "Missing" | "ForkLike" | "Unknown";
  remoteSummary: string;
  validationState: "Passed" | "Failed" | "Missing" | "Unknown";
  validationSummary: string;
  testEvidence: string[];
  publishReadinessSummary: string;
}

export interface ContextFile {
  path: string;
  summary: string;
  byteLength?: number;
  contentSha256?: string;
  matchedLineCount?: number;
  matchReasons?: string[];
}

export interface ForgeTask {
  id: string;
  title: string;
  objective: string;
  status: TaskStatus;
  currentPhase: string;
  createdAt: string;
  updatedAt: string;
  agentStates: AgentState[];
  planSteps: PlanStep[];
  events: RuntimeEvent[];
  approvals: ApprovalRecord[];
  toolCalls: ToolCall[];
  agentRunLoops: AgentRunLoop[];
  agentRunSteps: AgentRunStep[];
  taskCommandRuns: TaskCommandRun[];
  commandRerunEvidence: CommandRerunEvidence[];
  validationRuns: ValidationRun[];
  validationRepairBriefs: ValidationRepairBrief[];
  messages: TaskMessage[];
  planRevisions: PlanRevision[];
  editProposalRevisions: EditProposal[];
  contextFiles: ContextFile[];
  executionProposal?: ExecutionProposal;
  editProposal?: EditProposal;
  changedFiles: string[];
  reviewSummary?: string;
}

export interface CreateTaskRequest {
  title?: string;
  objective?: string;
}

export interface ApprovePlanRequest {
  note?: string;
}

export interface ApprovePlanAndRunRequest extends ApprovePlanRequest {
  preferredCommandID?: string;
  maxSteps?: number;
}

export interface ApproveValidationPresetRequest {
  presetID: string;
  note?: string;
}

export interface RunValidationRequest {
  presetID?: string;
}

export interface RunTaskCommandRequest {
  commandID?: string;
}

export interface RunAgentStepRequest {
  preferredCommandID?: string;
}

export interface RunAgentLoopRequest {
  preferredCommandID?: string;
  maxSteps?: number;
  resumeLoopID?: string;
}

export interface AgentRunLoopControlRequest {
  loopID?: string;
  note?: string;
}

export interface CancelTaskCommandRequest {
  taskCommandRunID?: string;
  note?: string;
}

export interface RerunRepairCommandRequest {
  commandRerunEvidenceID?: string;
}

export interface CreateTaskMessageRequest {
  content?: string;
}
