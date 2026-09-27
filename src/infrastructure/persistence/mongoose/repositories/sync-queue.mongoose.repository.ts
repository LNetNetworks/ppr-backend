import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { SyncJob, SyncJobDocument } from "../schemas/sync-job.schema";
import {
  SyncTask,
  SyncTaskDocument,
  SyncTaskStatus,
} from "../schemas/sync-task.schema";
import { randomUUID } from "crypto";
import { isRetryableTaskType } from "../../../../application/queue/port/queue.repository.port";

@Injectable()
export class SyncQueueMongooseRepository {
  private readonly logger = new Logger(SyncQueueMongooseRepository.name);

  private readonly attempts: number;
  private readonly retryBackoffSeconds: number[];

  constructor(
    @InjectModel(SyncJob.name)
    private readonly jobModel: Model<SyncJobDocument>,
    @InjectModel(SyncTask.name)
    private readonly taskModel: Model<SyncTaskDocument>,
    private readonly config: ConfigService,
  ) {
    this.attempts = this.config.getOrThrow<number>("syncWorker.maxAttempts");
    this.retryBackoffSeconds = this.config.getOrThrow<number[]>(
      "syncWorker.retryBackoffSeconds",
    );
  }

  /**
   * Devuelve la espera que corresponde al número de intento recibido. La
   * posición en la lista configurada es el número de intento; un intento sin
   * valor declarado no espera.
   */
  private retryDelayMs(attempts: number): number {
    const seconds = this.retryBackoffSeconds[attempts - 1];
    return seconds === undefined ? 0 : seconds * 1000;
  }

  async createJob(input: { requestedBy: string; type: string; total: number }) {
    const jobId = `job_${randomUUID()}`;
    await this.jobModel.create({
      jobId,
      requestedBy: input.requestedBy,
      type: input.type,
      status: "PENDING",
      progress: { total: input.total, processed: 0, ok: 0, failed: 0 },
    });
    return { jobId };
  }

  async bulkCreateTasks(input: {
    jobId: string;
    type: string;
    tasks: Array<{ dedupeKey: string; payload: any }>;
  }): Promise<{ inserted: number }> {
    if (!input.tasks?.length) return { inserted: 0 };

    const docs = input.tasks.map((t) => ({
      jobId: input.jobId,
      type: input.type,
      status: "PENDING" as SyncTaskStatus,
      attempts: 0,
      nextRunAt: new Date(),
      dedupeKey: t.dedupeKey,
      payload: t.payload,
    }));

    try {
      const res = await this.taskModel.insertMany(docs, { ordered: false });
      return { inserted: res.length };
    } catch (e: any) {
      this.logger.error(`bulkCreateTasks failed: ${e?.message ?? e}`);
      return { inserted: 0 };
    }
  }

  async lockNextBatch(input: {
    type: string;
    limit: number;
    workerId: string;
    lockSeconds: number;
  }) {
    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + input.lockSeconds * 1000);

    const locked: SyncTaskDocument[] = [];

    for (let i = 0; i < input.limit; i++) {
      const doc = await this.taskModel.findOneAndUpdate(
        {
          type: input.type,
          status: { $in: ["PENDING", "RETRY"] },
          nextRunAt: { $lte: now },
          attempts: { $lt: this.attempts },
          $or: [
            { lockedBy: { $exists: false } },
            { lockedBy: null },
            { lockExpiresAt: { $exists: false } },
            { lockExpiresAt: null },
            { lockExpiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            status: "RUNNING",
            lockedBy: input.workerId,
            lockExpiresAt,
          },
        },
        { sort: { nextRunAt: 1, createdAt: 1 }, new: true },
      );

      if (!doc) break;
      locked.push(doc);
    }

    return locked.map((d) => ({
      id: String(d._id),
      jobId: d.jobId,
      type: d.type,
      status: d.status,
      attempts: d.attempts,
      payload: d.payload,
    }));
  }

  async markDone(input: {
    taskId: string;
    workerId: string;
    result?: SyncTask["result"];
  }) {
    const res = await this.taskModel.updateOne(
      { _id: input.taskId, lockedBy: input.workerId },
      {
        $set: { status: "DONE", result: input.result },
        $unset: { lockedBy: 1, lockExpiresAt: 1 },
      },
    );
    this.warnIfNotMatched(res.matchedCount, "markDone", input.taskId);
  }

  /**
   * El cierre de una tarea filtra por el dueño del bloqueo, de modo que no
   * impacta nada si otro camino ya la cerró. Sin este aviso el worker cree que
   * cerró la tarea y no queda rastro de que no fue así.
   */
  private warnIfNotMatched(
    matchedCount: number,
    operation: string,
    taskId: string,
  ) {
    if (matchedCount > 0) return;

    this.logger.warn(
      `task close did not match any document: ${operation} on ${taskId}`,
    );
  }

  /**
   * Recupera las tareas que quedaron en RUNNING con el bloqueo vencido: su
   * worker ya no está. Las que mueven fondos se cierran como fallidas, porque
   * una transferencia cuya ejecución quedó en duda no puede repetirse sin
   * arriesgar un doble movimiento. El resto vuelve a la cola.
   *
   * Devuelve las cerradas para que quien llama resuelva el estado del registro
   * asociado.
   */
  async recoverAbandoned(input: {
    reason: string;
  }): Promise<Array<{ id: string; type: string; payload: any }>> {
    const now = new Date();
    const abandoned = await this.taskModel
      .find({ status: "RUNNING", lockExpiresAt: { $lte: now } })
      .lean();

    if (abandoned.length === 0) return [];

    const retryable = abandoned.filter((t) => isRetryableTaskType(t.type));
    const closed = abandoned.filter((t) => !isRetryableTaskType(t.type));

    if (retryable.length > 0) {
      await this.taskModel.updateMany(
        { _id: { $in: retryable.map((t) => t._id) } },
        {
          $set: { status: "RETRY", nextRunAt: now, lastError: input.reason },
          $unset: { lockedBy: 1, lockExpiresAt: 1 },
        },
      );
    }

    if (closed.length > 0) {
      await this.taskModel.updateMany(
        { _id: { $in: closed.map((t) => t._id) } },
        {
          $set: { status: "FAILED", lastError: input.reason },
          $unset: { lockedBy: 1, lockExpiresAt: 1 },
        },
      );
    }

    return closed.map((t) => ({
      id: String(t._id),
      type: t.type,
      payload: t.payload,
    }));
  }

  async markRetryOrFail(input: {
    taskId: string;
    workerId: string;
    error: string;
  }): Promise<"RETRY" | "FAILED" | undefined> {
    const task = await this.taskModel.findOne({
      _id: input.taskId,
      lockedBy: input.workerId,
    });

    if (!task) return;

    const attempts = (task.attempts ?? 0) + 1;
    const delayMs = this.retryDelayMs(attempts);
    const exhausted =
      !isRetryableTaskType(task.type) || attempts >= this.attempts;

    if (exhausted) {
      const res = await this.taskModel.updateOne(
        { _id: input.taskId, lockedBy: input.workerId },
        {
          $set: { status: "FAILED", attempts, lastError: input.error },
          $unset: { lockedBy: 1, lockExpiresAt: 1 },
        },
      );
      this.warnIfNotMatched(res.matchedCount, "markRetryOrFail", input.taskId);
      return "FAILED";
    }

    const res = await this.taskModel.updateOne(
      { _id: input.taskId, lockedBy: input.workerId },
      {
        $set: {
          status: "RETRY",
          attempts,
          lastError: input.error,
          nextRunAt: new Date(Date.now() + delayMs),
        },
        $unset: { lockedBy: 1, lockExpiresAt: 1 },
      },
    );
    this.warnIfNotMatched(res.matchedCount, "markRetryOrFail", input.taskId);
    return "RETRY";
  }

  async bumpJobProgress(input: {
    jobId: string;
    processed: number;
    ok: number;
    failed: number;
  }) {
    await this.jobModel.updateOne(
      { jobId: input.jobId },
      {
        $inc: {
          "progress.processed": input.processed,
          "progress.ok": input.ok,
          "progress.failed": input.failed,
        },
        $set: { status: "RUNNING" },
      },
    );
  }

  async finalizeJobIfDone(input: { jobId: string }) {
    const job = await this.jobModel.findOne({ jobId: input.jobId });
    if (!job) return;

    const remaining = await this.taskModel.countDocuments({
      jobId: input.jobId,
      status: { $in: ["PENDING", "RETRY", "RUNNING"] },
    });

    if (remaining !== 0) return;

    const failedTasks = await this.taskModel.countDocuments({
      jobId: input.jobId,
      status: "FAILED",
    });

    await this.jobModel.updateOne(
      { jobId: input.jobId },
      { $set: { status: failedTasks > 0 ? "FAILED" : "DONE" } },
    );
  }

  async getJob(jobId: string) {
    return this.jobModel.findOne({ jobId }).lean();
  }
}
