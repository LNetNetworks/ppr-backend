import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "../bootstrap/app.module";
import { resolveLogLevels } from "../infrastructure/config/log-levels";
import { ProjectRepository } from "../domain/projects/project.repository";
import { SequenceService } from "../infrastructure/persistence/mongoose/services/sequence.service";
import { SequenceKey } from "../infrastructure/persistence/mongoose/services/sequence-key";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(resolveLogLevels(app.get(ConfigService)));

  try {
    const projectRepo = app.get(ProjectRepository);
    const sequenceService = app.get(SequenceService);

    const maxWalletIndex = await projectRepo.getMaxWalletIndexToken();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const currentSeq = await sequenceService.ensureAtLeast(
      SequenceKey.PROJECT_WALLETS,
      maxWalletIndex,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  // El `finally` de main cierra el contenedor antes de llegar acá, pero el
  // logger es estático y no depende de él.
  Logger.flush();
  new Logger("SeedProjectWallets").error(
    "Failed to bootstrap project wallet sequence",
    error?.stack ?? error,
  );
  process.exitCode = 1;
});
