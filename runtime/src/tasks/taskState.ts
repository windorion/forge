import type { RuntimeEventBus } from "../events/runtimeEventBus.js";
import type { SqliteTaskStore } from "../taskStore.js";
import type { AgentState, ForgeTask, PlanStep, RuntimeEvent } from "../types.js";

export function createTaskState(options: {
  tasks: Map<string, ForgeTask>;
  taskStore: SqliteTaskStore;
  eventBus: RuntimeEventBus;
  observerMode: boolean;
}) {
  const { tasks, taskStore, eventBus, observerMode } = options;
  const emit = eventBus.emit.bind(eventBus);

  function reloadObserverTasks(): void {
    if (!observerMode) return;
    tasks.clear();
    for (const task of taskStore.loadTasks()) tasks.set(task.id, task);
  }

  function listTasks(): ForgeTask[] {
    return [...tasks.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  function saveTask(task: ForgeTask): void {
    taskStore.saveTask(task);
  }

  function saveAndBroadcast(task: ForgeTask, runtimeEvent: RuntimeEvent): void {
    task.events.push(runtimeEvent);
    task.updatedAt = runtimeEvent.createdAt;
    tasks.set(task.id, task);
    saveTask(task);
    emit(runtimeEvent.type, { taskID: task.id, message: runtimeEvent.message, task });
    emit("task.updated", { taskID: task.id, task });
  }

  function event(type: string, message: string): RuntimeEvent {
    return { type, message, createdAt: new Date().toISOString() };
  }

  function cloneAgents(agents: AgentState[]): AgentState[] {
    return agents.map((agent) => ({ ...agent }));
  }

  function clonePlanSteps(steps: PlanStep[]): PlanStep[] {
    return steps.map((step) => ({ ...step }));
  }

  function setAgent(
    task: ForgeTask,
    role: AgentState["role"],
    status: AgentState["status"],
    summary: string
  ): void {
    const agent = task.agentStates.find((candidate) => candidate.role === role);
    if (agent) {
      agent.status = status;
      agent.summary = summary;
    } else {
      task.agentStates.push({ role, status, summary });
    }
  }

  function setPlanStep(task: ForgeTask, stepID: string, status: PlanStep["status"], summary: string): void {
    const step = task.planSteps.find((candidate) => candidate.id === stepID);
    if (step) {
      step.status = status;
      step.summary = summary;
    }
  }

  function upsertPlanStep(task: ForgeTask, planStep: PlanStep): void {
    const index = task.planSteps.findIndex((candidate) => candidate.id === planStep.id);
    if (index >= 0) task.planSteps[index] = planStep;
    else task.planSteps.push(planStep);
  }

  return {
    emit,
    reloadObserverTasks,
    listTasks,
    saveTask,
    saveAndBroadcast,
    event,
    cloneAgents,
    clonePlanSteps,
    setAgent,
    setPlanStep,
    upsertPlanStep
  };
}
