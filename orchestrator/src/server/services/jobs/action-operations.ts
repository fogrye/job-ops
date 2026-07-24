import { getPrivateDataScope } from "@server/tenancy/private-scope";
import type { JobAction, JobActionResult } from "@shared/types";

export type JobActionOperationStatus = "pending" | "succeeded" | "failed";

export interface JobActionOperation {
  action: JobAction;
  jobId: string;
  status: JobActionOperationStatus;
  result?: JobActionResult;
  startedAt: number;
}

/**
 * Tracks single-job background actions (e.g. refresh-description) so a slow
 * action can be dispatched fire-and-forget and polled for completion instead
 * of holding the triggering HTTP request open for the full duration.
 *
 * In-memory and per-process by design: a server restart drops in-flight
 * operations, and the poll endpoint treats a missing operation as "not
 * found" rather than "still pending", so a client can never poll forever
 * waiting on state that no longer exists.
 */
const operationsByScope = new Map<string, Map<string, JobActionOperation>>();

function operationKey(jobId: string, action: JobAction): string {
  return `${action}:${jobId}`;
}

function operationsForScope(): Map<string, JobActionOperation> {
  const key = getPrivateDataScope().scopeKey;
  let operations = operationsByScope.get(key);
  if (!operations) {
    operations = new Map();
    operationsByScope.set(key, operations);
  }
  return operations;
}

export function getJobActionOperation(
  jobId: string,
  action: JobAction,
): JobActionOperation | undefined {
  return operationsForScope().get(operationKey(jobId, action));
}

/** Starts (or restarts, once the prior one is terminal) a tracked operation. */
export function startJobActionOperation(
  jobId: string,
  action: JobAction,
): JobActionOperation {
  const operation: JobActionOperation = {
    action,
    jobId,
    status: "pending",
    startedAt: Date.now(),
  };
  operationsForScope().set(operationKey(jobId, action), operation);
  return operation;
}

export function completeJobActionOperation(
  jobId: string,
  action: JobAction,
  result: JobActionResult,
): void {
  const operation = operationsForScope().get(operationKey(jobId, action));
  if (!operation) return;
  operation.status = result.ok ? "succeeded" : "failed";
  operation.result = result;
}
