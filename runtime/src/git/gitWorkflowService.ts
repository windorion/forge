import { createGitBranchService } from "./gitBranchService.js";
import { createGitBranchPublishService } from "./gitBranchPublishService.js";
import { createGitCommitService } from "./gitCommitService.js";
import { createGitPullRequestService } from "./gitPullRequestService.js";
import { createGitPushService } from "./gitPushService.js";

export type GitWorkflowServiceOptions = Parameters<typeof createGitBranchService>[0];

export function createGitWorkflowService(options: GitWorkflowServiceOptions) {
  return {
    ...createGitBranchService(options),
    ...createGitBranchPublishService(options),
    ...createGitCommitService(options),
    ...createGitPushService(options),
    ...createGitPullRequestService(options)
  };
}
