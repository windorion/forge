import type { PurgeWorkspaceHistoryRequest } from "../../types.js";
import {
  buildWorkspaceHistoryExport,
  buildWorkspaceHistoryRetentionPreview,
  purgeWorkspaceHistory,
  type WorkspaceRetentionSource
} from "../../tasks/workspaceHistoryRetention.js";
import { readJson } from "../request.js";
import { writeJson } from "../response.js";
import type { RuntimeRouteGroup, RuntimeRouteOptions } from "../runtimeRoutes.js";

export function createWorkspaceRoutes(options: RuntimeRouteOptions): RuntimeRouteGroup {
  const { taskStore, tasks, reloadObserverTasks, emit } = options;

  const source = (): WorkspaceRetentionSource => ({
    tasks: [...tasks.values()],
    repositoryIndex: taskStore.loadRepositoryIndexRetentionSnapshot(),
    priorPurges: taskStore.loadWorkspaceHistoryPurgeReceipts().length
  });

  return async (request, response, url) => {
    if (request.method === "GET" && url.pathname === "/workspace/history-retention-preview") {
      reloadObserverTasks();
      writeJson(
        response,
        200,
        buildWorkspaceHistoryRetentionPreview(source(), url.searchParams.get("scopes") ?? undefined)
      );
      return true;
    }

    if (request.method === "GET" && url.pathname === "/workspace/history-export") {
      reloadObserverTasks();
      writeJson(
        response,
        200,
        buildWorkspaceHistoryExport(source(), url.searchParams.get("scopes") ?? undefined)
      );
      return true;
    }

    if (request.method === "POST" && url.pathname === "/workspace/purge-history") {
      const input = await readJson<PurgeWorkspaceHistoryRequest>(request);
      const result = purgeWorkspaceHistory(source(), input);
      taskStore.saveWorkspaceHistoryPurge(
        result.changedTasks,
        result.receipt,
        result.repositoryIndexesCleared
      );
      for (const task of result.changedTasks) {
        tasks.set(task.id, task);
        emit("task.updated", { taskID: task.id, task });
      }
      emit("workspace.history.purged", {
        receipt: result.receipt,
        changedTaskIDs: result.changedTaskIDs,
        repositoryIndexesCleared: result.repositoryIndexesCleared
      });
      writeJson(response, 200, {
        receipt: result.receipt,
        changedTaskIDs: result.changedTaskIDs,
        repositoryIndexesCleared: result.repositoryIndexesCleared
      });
      return true;
    }

    return false;
  };
}
