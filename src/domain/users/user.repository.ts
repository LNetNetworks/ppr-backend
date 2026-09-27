import { User } from "./user.entity";
import { UserRole } from "./user-role.enum";

/**
 * Datos que una sincronización con Keycloak escribe sobre el usuario. El rol es
 * obligatorio: quien sincroniza ya lo resolvió y validó contra el enum, de modo
 * que no hay caso en que llegue ausente.
 */
export type KeycloakSyncPayload = {
  keycloak_sub: string;
  email?: string;
  name?: string;
  surname?: string;
  active?: boolean;
  role: UserRole;
};

export abstract class UserRepository {
  abstract save(User: User): Promise<User>;
  abstract findById(id: string): Promise<User | null>;
  abstract findAll(params: {
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<User[]>;
  abstract delete(id: string): Promise<void>;
  abstract findByKeycloakSub(sub: string): Promise<User | null>;

  /**
   * Busca por coincidencia parcial de correo, para que el front pueda ofrecer
   * candidatos mientras se escribe. No sirve para resolver identidad: devuelve
   * varios y sólo considera a quienes ya entraron alguna vez.
   */
  abstract findByEmail(email: string): Promise<User[]>;

  /**
   * Busca por correo exacto, sin condicionar a que la persona haya entrado
   * antes. Es la búsqueda que resuelve identidad: un correo pertenece a una
   * sola persona.
   */
  abstract findOneByEmail(email: string): Promise<User | null>;

  abstract findByRole(role: string): Promise<User | null>;

  /** Refresca al usuario que ya tiene ese identificador de Keycloak asociado. */
  abstract refreshFromKeycloak(
    payload: KeycloakSyncPayload,
  ): Promise<User | null>;

  /** Asocia el identificador de Keycloak al usuario que tenga ese correo. */
  abstract linkKeycloakIdentity(
    payload: KeycloakSyncPayload & { email: string },
  ): Promise<User | null>;
}
