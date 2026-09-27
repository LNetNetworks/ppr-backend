import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UserRepository } from "../../../domain/users/user.repository";
import { OrganizationUserRepository } from "../../../domain/organizations/organization-user.repository";
import { SequenceService } from "../../../infrastructure/persistence/mongoose/services/sequence.service";
import { SequenceKey } from "../../../infrastructure/persistence/mongoose/services/sequence-key";
import { User } from "../../../domain/users/user.entity";
import { OrganizationUser } from "../../../domain/organizations/organization-user.entity";
import { UserRole } from "../../../domain/users/user-role.enum";

type KeycloakToken = {
  sub: string;
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  roles: string[];
};

const DEFAULT_ORG_ID = "org_001";

@Injectable()
export class SyncUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly seq: SequenceService,
    private readonly orgUsers: OrganizationUserRepository,
  ) {}

  async execute(token: KeycloakToken): Promise<User> {
    const role = this.resolveRole(token.roles);

    const foundBySub = await this.users.findByKeycloakSub(token.sub);
    if (foundBySub) {
      return this.refresh(token, foundBySub, role);
    }

    if (token.email) {
      const foundByEmail = await this.users.findOneByEmail(token.email);
      if (foundByEmail) {
        return this.link(token.email, token, foundByEmail, role);
      }
    }

    return this.createFromToken(token, role);
  }

  private async refresh(
    token: KeycloakToken,
    existing: User,
    role: UserRole,
  ): Promise<User> {
    const refreshed = await this.users.refreshFromKeycloak({
      keycloak_sub: token.sub,
      email: token.email ?? existing.user_email,
      name: token.given_name ?? existing.name,
      surname: token.family_name ?? existing.surname,
      active: true,
      role,
    });

    if (!refreshed) {
      throw new NotFoundException("The user vanished during synchronization");
    }

    return refreshed;
  }

  private async link(
    email: string,
    token: KeycloakToken,
    existing: User,
    role: UserRole,
  ): Promise<User> {
    const linked = await this.users.linkKeycloakIdentity({
      keycloak_sub: token.sub,
      email,
      name: token.given_name ?? existing.name,
      surname: token.family_name ?? existing.surname,
      active: true,
      role,
    });

    if (!linked) {
      throw new NotFoundException("The user vanished during synchronization");
    }

    return linked;
  }

  /**
   * Toma el único rol de aplicación que el token debe traer. Una persona tiene
   * un rol: quien necesite dos usa dos identidades en Keycloak, una por rol, de
   * modo que traer varios es una configuración inválida y no algo a resolver
   * eligiendo. Elegir además dependería del orden en que el token los enumera,
   * que no está garantizado y haría variar el rol entre sincronizaciones.
   */
  private resolveRole(roles: string[]): UserRole {
    const known = Object.values(UserRole) as string[];
    const appRoles = roles.filter((role) => known.includes(role));

    if (appRoles.length === 0) {
      throw new ForbiddenException(
        "The token carries no application role. Assign exactly one in Keycloak.",
      );
    }

    if (appRoles.length > 1) {
      throw new ForbiddenException(
        `The token carries ${appRoles.length} application roles and exactly one is required. Use a separate Keycloak user per role.`,
      );
    }

    return appRoles[0] as UserRole;
  }

  private async createFromToken(
    token: KeycloakToken,
    role: UserRole,
  ): Promise<User> {
    const next = await this.seq.next(SequenceKey.USERS);
    const id_user = `usr_${String(next).padStart(3, "0")}`;

    const entity = new User(
      id_user,
      DEFAULT_ORG_ID,
      token.given_name ?? "",
      token.family_name ?? "",
      "",
      "",
      "",
      "",
      token.email ?? "",
      "000-00000000",
      true,
      new Date("1980-02-09"),
      role,
      "",
      "",
      "",
      token.sub,
      "",
    );

    // El identificador del OrganizationUser se escribe a mano y coincide con el
    // de la organización por casualidad, no por diseño. Es la deuda R11 y este
    // change no la toca.
    const id_organization_user = "org_001";

    await this.orgUsers.save(
      new OrganizationUser(id_organization_user, DEFAULT_ORG_ID, id_user, role),
    );

    return this.users.save(entity);
  }
}
