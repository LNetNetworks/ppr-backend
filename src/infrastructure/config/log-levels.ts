import { LogLevel } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Traduce el nivel de log configurado a la lista que espera Nest. El esquema de
 * validación ya garantiza que cada valor sea uno de los que el framework acepta,
 * de modo que acá sólo hay que separarlos.
 *
 * Gobierna los mensajes del framework y los del Logger de Nest. Los registros
 * hechos con console no pasan por acá y no se ven afectados.
 */
export function resolveLogLevels(config: ConfigService): LogLevel[] {
  return config
    .getOrThrow<string>("logging.level")
    .split(",")
    .map((level) => level.trim())
    .filter((level) => level.length > 0) as LogLevel[];
}
