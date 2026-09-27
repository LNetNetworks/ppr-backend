import * as Joi from "joi";
import { CustomHelpers, ErrorReport } from "joi";
import { Mnemonic } from "ethers";
import { parseCorsOrigins } from "./app.config";

/**
 * Checks that the value is an HTTP origin in canonical form: scheme, host and
 * optional port, with no path, query or trailing slash. The browser sends the
 * Origin header in exactly that form, so any other one would never match.
 */
function isCanonicalOrigin(value: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  return `${parsed.protocol}//${parsed.host}` === value;
}

/**
 * Validates the CORS origin list without imposing a maximum number of entries.
 * Rejecting a malformed origin here keeps the failure from surfacing later in
 * the browser, where the symptom does not point at the cause.
 */
function validateCorsOrigins(
  value: string,
  helpers: CustomHelpers,
): string | ErrorReport {
  const origins = parseCorsOrigins(value);

  if (origins.length === 0) {
    return helpers.message({
      custom: "CORS_ORIGINS must list at least one origin",
    });
  }

  const malformed = origins.filter((origin) => !isCanonicalOrigin(origin));
  if (malformed.length > 0) {
    return helpers.message({
      custom: `CORS_ORIGINS has malformed origins: ${malformed.join(", ")}`,
    });
  }

  return value;
}

/**
 * Validates that the value is a BIP-39 mnemonic phrase in any of its standard
 * lengths, checksum included. A phrase whose checksum does not verify derives
 * addresses other than the expected ones without raising any error, so it has
 * to be rejected at startup rather than at signing time. The message names the
 * variable and never echoes the value, which would otherwise reach stdout and
 * the deployment logs.
 */
function validateMnemonic(
  value: string,
  helpers: CustomHelpers,
): string | ErrorReport {
  if (!Mnemonic.isValidMnemonic(value)) {
    return helpers.message({
      custom:
        "GSPONSOR_SEED must be a valid BIP-39 mnemonic phrase, checksum included",
    });
  }

  return value;
}

export const envSchema = Joi.object({
  NODE_ENV: Joi.string().required(),
  PORT: Joi.number().default(3000),
  GLOBAL_PREFIX: Joi.string().default("ppr"),
  CORS_ORIGINS: Joi.string().required().custom(validateCorsOrigins),

  MONGODB_URI: Joi.string().uri().required(),
  MONGODB_DB: Joi.string().required(),

  KEYCLOAK_AUTH_SERVER_URL: Joi.string().uri().required(),
  KEYCLOAK_REALM: Joi.string().required(),
  KEYCLOAK_CLIENT_ID: Joi.string().required(),
  KEYCLOAK_SECRET: Joi.string().required(),
  KEYCLOAK_REALM_PUBLIC_KEY: Joi.string().required(),

  ZK_KEYCLOAK_TOKEN_URL: Joi.string().uri().required(),
  ZK_PERMISSION_SERVICE_URL: Joi.string().uri().allow("").default(""),
  ZK_RPC_NODE_URL: Joi.string().uri().required(),
  ZK_USER_PRIVATE_KEY: Joi.string().required(),
  ZK_KEYCLOAK_CLIENT_ID: Joi.string().required(),
  ZK_KEYCLOAK_CLIENT_SECRET: Joi.string().required(),
  ZK_KEYCLOAK_USERNAME: Joi.string().required(),
  ZK_KEYCLOAK_PASSWORD: Joi.string().required(),
  TRUSTED_FORWARDER: Joi.string().required(),

  RPC_URL: Joi.string().uri().required(),
  PRIVATE_KEY: Joi.string().required(),
  GAS_NODE_ADDRESS: Joi.string().allow("").optional(),
  // A window in milliseconds, not an absolute instant. The 24 h ceiling rejects
  // the timestamps that were used before this variable was wired up.
  GAS_EXPIRATION: Joi.number()
    .integer()
    .min(1)
    .max(86_400_000)
    .default(300_000),
  BLOCKCHAIN_NETWORK: Joi.string().valid("lacchain", "prividium").required(),

  FILE_STORE_API_URL: Joi.string().uri().required(),
  FILE_STORE_API_KEY: Joi.string().min(1).required(),
  FILE_STORE_TIMEOUT_MS: Joi.number().integer().min(1000).default(60_000),

  HTTP_CLIENT_TIMEOUT_MS: Joi.number().integer().min(1000).default(10_000),
  // Margen con el que se pide un token nuevo antes de que expire el vigente. Un
  // valor de 0 significa reutilizarlo hasta el instante mismo de su expiración.
  ZK_TOKEN_REFRESH_MARGIN_MS: Joi.number().integer().min(0).default(30_000),

  KEYCLOAK_LOG_LEVEL: Joi.string()
    .pattern(
      /^(log|error|warn|debug|verbose)(,(log|error|warn|debug|verbose))*$/,
    )
    .default("warn,debug"),

  NEST_LOG_LEVEL: Joi.string()
    .pattern(
      /^(log|error|warn|debug|verbose)(,(log|error|warn|debug|verbose))*$/,
    )
    .default("log,error,warn"),

  POK_API_URL: Joi.string().uri().required(),
  POK_APIKEY: Joi.string().required(),
  BRIDGE_API_URL: Joi.string().uri().required(),
  BRIDGE_API_KEY: Joi.string().required(),
  BRIDGE_TIMEOUT_MS: Joi.number().integer().min(1000).default(60_000),

  SYNC_WORKER_ENABLED: Joi.boolean().default(true),
  SYNC_TASK_BATCH_SIZE: Joi.number().integer().min(1).default(3),
  SYNC_TASK_CONCURRENCY: Joi.number().integer().min(1).default(1),
  SYNC_MAX_ATTEMPTS: Joi.number().integer().min(1).default(3),
  // La posición en la lista es el número de intento: el primer fallo espera el
  // primer valor, el segundo el segundo. Un intento sin valor declarado no
  // espera, que es el comportamiento vigente a partir del tercero.
  SYNC_RETRY_BACKOFF_SECONDS: Joi.string()
    .pattern(/^\d+(,\d+)*$/)
    .default("30,120"),
  // El mínimo supera el valor por defecto de BRIDGE_TIMEOUT_MS (60 s). Una
  // ventana menor daría por abandonada una tarea cuya transferencia sigue en
  // vuelo, y el cierre por abandono la marcaría como fallida. Cuando
  // BRIDGE_TIMEOUT_MS se define explícitamente, la relación entre ambos se
  // comprueba al arrancar, porque acá cada variable se valida por separado.
  SYNC_LOCK_SECONDS: Joi.number().integer().min(61).default(120),
  RESEND_API_KEY: Joi.string().required(),
  MAIL_FROM: Joi.string().required(),
  WALLET_DERIVATION_NAMESPACE: Joi.alternatives()
    .try(
      Joi.number().integer().min(0),
      Joi.string().valid("local", "dev", "stage", "prod", "production"),
    )
    .required(),
  ADDRESS_CONTRACT: Joi.string().required(),
  ADDRESS_TOKEN: Joi.string().required(),
  ADDRESS_GAS_PRIVIDIUM: Joi.string().required(),
  GSPONSOR_SEED: Joi.string().required().custom(validateMnemonic),
  GSPONSOR_TRANSFER_CONTRACT: Joi.string().required(),
  ADDRESS_TOKEN_USDC: Joi.string().required(),

  METRICS_TOKEN: Joi.string().min(16).required(),
});
