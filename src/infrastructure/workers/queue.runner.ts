import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueueRepositoryPort } from "../../application/queue/port/queue.repository.port";
import { QueueProcessorsRegistry } from "../workers/processors/queue-processor.registry";
import { Cron } from "@nestjs/schedule";

@Injectable()
export class QueueRunner {
  private readonly logger = new Logger(QueueRunner.name);
  private readonly workerId = `worker_${process.pid}`;

  constructor(
    private readonly config: ConfigService,
    private readonly queue: QueueRepositoryPort,
    private readonly registry: QueueProcessorsRegistry,
  ) {}

  @Cron("*/20 * * * * *")
  async tick() {
    if (!this.config.getOrThrow<boolean>("syncWorker.enabled")) return;

    const batchSize = this.config.getOrThrow<number>("syncWorker.batchSize");
    // SYNC_LOCK_SECONDS debe superar a BRIDGE_TIMEOUT_MS: una ventana menor
    // daría por abandonada una tarea cuya transferencia sigue en vuelo, y el
    // cierre por abandono la marcaría como fallida. La relación se comprueba al
    // arrancar, en el bootstrap.
    const lockSeconds = this.config.getOrThrow<number>(
      "syncWorker.lockSeconds",
    );
    const concurrency = this.config.getOrThrow<number>(
      "syncWorker.concurrency",
    );
    this.logger.debug(`tick ${new Date().toISOString()}`);

    await this.recoverAbandonedTasks();

    for (const p of this.registry.getAll()) {
      const tasks = await this.queue.lockNextBatch({
        type: p.type,
        limit: batchSize,
        workerId: this.workerId,
        lockSeconds,
      });

      if (tasks[0])
        this.logger.debug(`locked sample ${tasks[0].id} (${p.type})`);
      if (!tasks.length) continue;

      for (let i = 0; i < tasks.length; i += concurrency) {
        const chunk = tasks.slice(i, i + concurrency);

        await Promise.allSettled(
          chunk.map(async (t) => {
            try {
              this.logger.log(`calling processor for task ${t.id}`);

              const result = await p.process({
                id: t.id,
                jobId: t.jobId,
                payload: t.payload,
              });

              await this.queue.markDone({
                taskId: t.id,
                workerId: this.workerId,
                result,
              });

              try {
                await this.queue.bumpJobProgress({
                  jobId: t.jobId,
                  processed: 1,
                  ok: 1,
                  failed: 0,
                });
              } catch (e: any) {
                this.logger.error(
                  `bumpJobProgress failed after task success: ${e?.message}`,
                );
              }
            } catch (e: any) {
              let finalStatus: "RETRY" | "FAILED" | undefined;

              try {
                finalStatus = await this.queue.markRetryOrFail({
                  taskId: t.id,
                  workerId: this.workerId,
                  error: e?.message ?? "error",
                });
              } catch (marError: any) {
                this.logger.error(
                  `markRetryOrFail failed: ${marError?.message}`,
                );
              }

              if (finalStatus === "FAILED" && p.markFailed) {
                try {
                  await p.markFailed(t.payload);
                } catch (markError: any) {
                  this.logger.error(
                    `could not mark failed task ${t.id} (${p.type}) on domain: ${markError?.message}`,
                  );
                }
              }

              try {
                await this.queue.bumpJobProgress({
                  jobId: t.jobId,
                  processed: 1,
                  ok: 0,
                  failed: finalStatus === "FAILED" ? 1 : 0,
                });
              } catch (bumError: any) {
                this.logger.error(
                  `bumpJobProgress failed after task failure: ${bumError?.message}`,
                );
              }
            }
          }),
        );
        this.logger.debug(`chunk finished at offset ${i}`);
      }

      const jobIds = [...new Set(tasks.map((t) => t.jobId))];
      for (const jobId of jobIds) await this.queue.finalizeJobIfDone({ jobId });
    }
  }

  /**
   * Cierra las tareas cuyo worker desapareció. Las que mueven fondos no se
   * reejecutan: se marcan como fallidas y se arrastra ese resultado al registro
   * de dominio, para que no quede pendiente para siempre.
   */
  private async recoverAbandonedTasks() {
    const closed = await this.queue.recoverAbandoned({
      reason: "Worker lost while the task was running; verify it on chain",
    });

    for (const task of closed) {
      const processor = this.registry
        .getAll()
        .find((p) => p.type === task.type);

      if (!processor?.markFailed) continue;

      try {
        await processor.markFailed(task.payload);
      } catch (error: any) {
        this.logger.error(
          `could not mark abandoned task ${task.id} (${task.type}) as failed: ${error?.message ?? error}`,
        );
      }
    }
  }
}
