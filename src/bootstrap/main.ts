import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { resolveLogLevels } from "../infrastructure/config/log-levels";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  // Los logs quedan en espera hasta poder leer los niveles de la configuración:
  // el framework emite antes de que el contenedor exista, y sin esto esos
  // primeros mensajes saldrían sin filtrar.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const configService = app.get(ConfigService);
  app.useLogger(resolveLogLevels(configService));
  ensureLockOutlastsBridgeTimeout(configService);

  const prefix = configService.getOrThrow<string>("app.globalPrefix");

  app.setGlobalPrefix(prefix);

  app.enableCors({
    origin: configService.getOrThrow<string[]>("app.corsOrigins"),
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle("PPR API")
    .setDescription("API de PPR, fondos, proveedores de servicio y evidencias")
    .setVersion("1.0.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Access Token emitido por Keycloak",
      },
      "keycloak",
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
  });

  SwaggerModule.setup("docs", app, document, {
    useGlobalPrefix: true,
    jsonDocumentUrl: "openapi.json",
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: "alpha",
      operationsSorter: "alpha",
    },
    customSiteTitle: "PPR API Docs",
  });

  const port = configService.getOrThrow<number>("app.port");

  await app.listen(port, "0.0.0.0");

  const url = await app.getUrl();
  logger.log(`App listening on ${url}/${prefix}`);
  logger.log(`Swagger ${url}/${prefix}/docs`);
  logger.log(`Health ${url}/${prefix}/health`);
}

/**
 * El cierre de tareas abandonadas da por perdido al worker cuando vence la
 * ventana de bloqueo, y no reejecuta la transferencia. Si esa ventana no
 * superara el tiempo máximo de la llamada al bridge, una tarea cuya
 * transferencia sigue en vuelo se cerraría como fallida.
 *
 * El esquema valida cada variable por separado, de modo que la relación entre
 * ambas sólo puede comprobarse acá, con la configuración ya resuelta.
 */
function ensureLockOutlastsBridgeTimeout(config: ConfigService) {
  const lockSeconds = config.getOrThrow<number>("syncWorker.lockSeconds");
  const bridgeTimeoutSeconds =
    config.getOrThrow<number>("bridge.timeoutMs") / 1000;

  if (lockSeconds > bridgeTimeoutSeconds) return;

  throw new Error(
    `SYNC_LOCK_SECONDS (${lockSeconds}s) must be greater than BRIDGE_TIMEOUT_MS ` +
      `(${bridgeTimeoutSeconds}s): a shorter lock would treat an in-flight ` +
      `transfer as abandoned and close it as failed.`,
  );
}

bootstrap().catch((err) => {
  // El contenedor arranca con los logs en espera y esa espera sólo se vacía
  // cuando se fijan los niveles. Si la creación falla antes, lo retenido se
  // perdería junto con el motivo del fallo.
  Logger.flush();
  new Logger("Bootstrap").error("Fatal bootstrap error", err?.stack ?? err);
  process.exit(1);
});
