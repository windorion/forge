import { createProcessRunner } from "./processRunner.js";
import { createRepairEvidenceService } from "./repairEvidenceService.js";
import { createTaskCommandService } from "./taskCommandService.js";
import { createValidationRunService } from "./validationRunService.js";
import type { ValidationServiceOptions } from "./validationServiceTypes.js";

export function createValidationService(options: ValidationServiceOptions) {
  const processRunner = createProcessRunner(options);
  const repairEvidence = createRepairEvidenceService(options);
  const taskCommands = createTaskCommandService({ ...options, processRunner, repairEvidence });
  const validationRuns = createValidationRunService({ ...options, processRunner, repairEvidence });

  return {
    ...taskCommands,
    cancelTaskCommand: processRunner.cancelTaskCommand,
    requestValidationCancellation: processRunner.requestValidationCancellation,
    ...validationRuns,
    ...repairEvidence
  };
}

export type { InternalValidationCommand, InternalValidationPreset } from "./validationServiceTypes.js";
