/**
 * Roles de Keycloak que la aplicación reconoce. Son los nombres que el realm
 * emite en el token y que los guards matchean; no confundir con UserRole, el
 * rol de negocio que vive en el dominio y se persiste con el usuario.
 */
export const KeycloakRole = {
  VERIFIER: "verifier",
  SPONSOR: "sponsor",
  USER: "user",
  PROVIDER: "provider",
} as const;

/**
 * Conjunto completo de roles de la aplicación. Una ruta que lo declara exige
 * token autenticado que traiga alguno de ellos, sin distinguir cuál.
 *
 * La lista se enumera a mano en lugar de derivarse de KeycloakRole: así, sumar
 * un rol al vocabulario no le concede acceso a estas rutas por sí solo, y
 * ampliarlo exige una línea deliberada acá.
 */
export const ANY_APP_ROLE: string[] = [
  KeycloakRole.VERIFIER,
  KeycloakRole.SPONSOR,
  KeycloakRole.USER,
  KeycloakRole.PROVIDER,
];
