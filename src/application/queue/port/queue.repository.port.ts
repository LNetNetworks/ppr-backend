/**
 * Tipos de tarea que mueven fondos. El servicio que las ejecuta no acepta clave
 * de idempotencia, de modo que repetir una es transferir de nuevo: se ejecutan
 * una sola vez y un fallo las cierra directamente. El resto de los tipos sí
 * reintenta, porque repetirlos es inocuo.
 */
export const NON_RETRYABLE_TASK_TYPES: readonly string[] = [
  "PROJECT_BRIDGE_WITHDRAW",
  "PROJECT_BRIDGE_DEPOSIT",
];

export function isRetryableTaskType(type: string): boolean {
  return !NON_RETRYABLE_TASK_TYPES.includes(type);
}

export type QueueJobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";
export type QueueTaskStatus =
  | "PENDING"
  | "RUNNING"
  | "DONE"
  | "RETRY"
  | "FAILED";

export type QueueTaskPayload = Record<string, any>;

export interface QueueTask {
  id: string;
  jobId: string;
  type: string;
  status: QueueTaskStatus;
  attempts: number;
  payload: QueueTaskPayload;
}

export abstract class QueueRepositoryPort {
  abstract createJob(input: {
    requestedBy: string;
    type: string;
    total: number;
  }): Promise<{ jobId: string }>;

  abstract bulkCreateTasks(input: {
    jobId: string;
    type: string;
    tasks: Array<{ dedupeKey: string; payload: QueueTaskPayload }>;
  }): Promise<{ inserted: number }>;

  abstract lockNextBatch(input: {
    type: string;
    limit: number;
    workerId: string;
    lockSeconds: number;
  }): Promise<QueueTask[]>;

  abstract markDone(input: {
    taskId: string;
    workerId: string;
    result?: any;
  }): Promise<void>;

  abstract markRetryOrFail(input: {
    taskId: string;
    workerId: string;
    error: string;
  }): Promise<"RETRY" | "FAILED" | undefined>;
  abstract bumpJobProgress(input: {
    jobId: string;
    processed: number;
    ok: number;
    failed: number;
  }): Promise<void>;

  abstract recoverAbandoned(input: {
    reason: string;
  }): Promise<Array<{ id: string; type: string; payload: QueueTaskPayload }>>;

  abstract finalizeJobIfDone(input: { jobId: string }): Promise<void>;

  abstract getJob(jobId: string): Promise<any>;
}
