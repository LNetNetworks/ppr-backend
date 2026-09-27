/**
 * Claves de los contadores que emiten los identificadores determinísticos.
 *
 * Cada valor es el campo `key` de un documento que ya existe en la colección
 * `counters`, con su secuencia acumulada. `SequenceService.next` hace upsert: una
 * clave desconocida no falla, crea un contador nuevo y devuelve 1, de modo que a
 * partir de ahí se emiten identificadores que chocan con los ya asignados.
 *
 * Por eso los valores están escritos exactamente como están en la base, con las
 * cuatro convenciones que conviven y con el error de tipeo de
 * `permission_user_adittional`. Corregir cualquiera de ellos exige migrar los
 * documentos de `counters`, no editar este archivo.
 *
 * El nombre del miembro sí es nuestro y se escribe bien: lo que no se puede
 * tocar es el valor.
 */
export const SequenceKey = {
  AUDIT_REVISIONS: "AuditRevisions",
  ORGANIZATION_USERS: "OrganizationUsers",
  PERMISSION_ROLE: "PermissionRole",
  PERMISSIONS: "Permissions",
  PHASES: "Phases",
  TASKS: "Tasks",
  CONTRIBUTIONS: "contributions",
  EVIDENCES: "evidences",
  ORGANIZATIONS: "organizations",
  PROJECTS: "projects",
  TRANSACTIONS: "transactions",
  USERS: "users",
  PERMISSION_USER_ADDITIONAL: "permission_user_adittional",
  PHASE_PROJECT_TASK: "phase_project_task",
  PROJECT_WALLETS: "project_wallets",
  PROJECTS_USER: "projects_user",
} as const;

export type SequenceKey = (typeof SequenceKey)[keyof typeof SequenceKey];
