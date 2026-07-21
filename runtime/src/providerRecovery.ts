// Bounded, side-effect-free structured-output recovery. Generation calls
// (intent brief, plan-context request, plan revision, edit proposal) produce
// review artifacts and never mutate the workspace, so a malformed output can
// be safely re-requested with a correction. This module is pure/injectable so
// the recovery loop is unit-testable without a real provider.

export type StructuredRecoveryResult<T> = {
  value: T;
  attemptCount: number;
  recovered: boolean;
  attemptErrors: string[];
};

export class StructuredRecoveryError extends Error {
  constructor(
    readonly attemptCount: number,
    readonly attemptErrors: string[]
  ) {
    super(`Structured output could not be validated after ${attemptCount} attempts.`);
    this.name = "StructuredRecoveryError";
  }
}

export type StructuredRecoveryOptions<T> = {
  /** Maximum attempts, including the first. Clamped to >= 1. */
  maxAttempts: number;
  /** Produce raw output; `correction` is set on retries. Never side-effecting. */
  produce: (correction: string | undefined) => Promise<unknown>;
  /** Map raw output to T; must throw on malformed output. */
  normalize: (raw: unknown) => T;
  /** Guidance appended to the correction re-prompt. */
  correctionGuidance: string;
  /** True when an error is a recoverable output-format error (vs. a hard failure). */
  isFormatError: (error: unknown) => boolean;
  /** Compact a caught error to a short string for the correction and evidence. */
  compactError: (error: unknown) => string;
};

export async function withStructuredRecovery<T>(
  options: StructuredRecoveryOptions<T>
): Promise<StructuredRecoveryResult<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts);
  const attemptErrors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const correction = attemptErrors.length > 0
      ? [
          "Your previous output could not be validated.",
          `Validation error: ${attemptErrors.at(-1)}`,
          options.correctionGuidance
        ].join("\n")
      : undefined;

    let raw: unknown;
    try {
      raw = await options.produce(correction);
    } catch (error) {
      if (!options.isFormatError(error)) {
        throw error;
      }
      attemptErrors.push(options.compactError(error));
      continue;
    }

    try {
      const value = options.normalize(raw);
      return {
        value,
        attemptCount: attempt,
        recovered: attempt > 1,
        attemptErrors
      };
    } catch (error) {
      attemptErrors.push(options.compactError(error));
    }
  }

  throw new StructuredRecoveryError(maxAttempts, attemptErrors);
}
