import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User as UserDoc } from "../schemas/user.schema";
import {
  UserRepository,
  KeycloakSyncPayload,
} from "../../../../domain/users/user.repository";
import { User as UserEntity } from "../../../../domain/users/user.entity";
import { UserRole } from "../../../../domain/users/user-role.enum";

/**
 * Los campos del documento que la entidad necesita. Se declara acá en lugar de
 * usar el tipo del documento de Mongoose porque el resultado de `lean()` no es
 * asignable a él: trae el documento aplanado, sin los métodos del modelo.
 */
type PlainUser = {
  id_user: string;
  id_organization: string;
  name: string;
  surname: string;
  address_street: string;
  address_number: string;
  address_state: string;
  address_country: string;
  user_email: string;
  phone_mobile: string;
  active: boolean;
  birthday: Date;
  role: UserRole;
  address_seed_token?: string;
  wallet_address_token?: string;
  did_user?: string;
  keycloak_sub?: string;
  apikeypok?: string;
};

@Injectable()
export class UserMongooseRepository extends UserRepository {
  constructor(
    @InjectModel(UserDoc.name) private readonly model: Model<UserDoc>,
  ) {
    super();
  }

  async save(entity: UserEntity): Promise<UserEntity> {
    await this.model.updateOne({ id_user: entity.id_user }, entity, {
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });
    return entity;
  }

  async findById(id: string): Promise<UserEntity | null> {
    const doc = await this.model.findOne({ id_user: id }).lean();
    return doc
      ? new UserEntity(
          doc.id_user,
          doc.id_organization,
          doc.name,
          doc.surname,
          doc.address_street,
          doc.address_number,
          doc.address_state,
          doc.address_country,
          doc.user_email,
          doc.phone_mobile,
          doc.active,
          doc.birthday,
          doc.role as any,
          doc.address_seed_token,
          doc.wallet_address_token,
          doc.did_user,
          doc.keycloak_sub,
          doc.apikeypok,
        )
      : null;
  }

  async findAll(params: {
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<UserEntity[]> {
    const q: any = {};
    if (params.userId) q.id_user = params.userId;
    const docs = await this.model
      .find(q)
      .skip(params.offset ?? 0)
      .limit(params.limit ?? 50)
      .lean();
    return docs.map(
      (doc) =>
        new UserEntity(
          doc.id_user,
          doc.id_organization,
          doc.name,
          doc.surname,
          doc.address_street,
          doc.address_number,
          doc.address_state,
          doc.address_country,
          doc.user_email,
          doc.phone_mobile,
          doc.active,
          doc.birthday,
          doc.role as any,
          doc.address_seed_token,
          doc.wallet_address_token,
          doc.did_user,
          doc.keycloak_sub,
          doc.apikeypok,
        ),
    );
  }

  async delete(id: string) {
    await this.model.deleteOne({ id_user: id });
  }

  async findByKeycloakSub(sub: string): Promise<UserEntity | null> {
    const doc = await this.model.findOne({ keycloak_sub: sub }).lean();
    return doc
      ? new UserEntity(
          doc.id_user,
          doc.id_organization,
          doc.name,
          doc.surname,
          doc.address_street,
          doc.address_number,
          doc.address_state,
          doc.address_country,
          doc.user_email,
          doc.phone_mobile,
          doc.active,
          doc.birthday,
          doc.role as any,
          doc.address_seed_token,
          doc.wallet_address_token,
          doc.did_user,
          doc.keycloak_sub,
          doc.apikeypok,
        )
      : null;
  }

  async findByEmail(email: string): Promise<UserEntity[]> {
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const docs = await this.model
      .find({
        $and: [
          { user_email: { $regex: escapedEmail, $options: "i" } },
          { keycloak_sub: { $exists: true, $nin: [null, ""] } },
        ],
      })
      .lean();

    if (!docs || docs.length === 0) {
      return [];
    }
    return docs.map(
      (doc) =>
        new UserEntity(
          doc.id_user,
          doc.id_organization,
          doc.name,
          doc.surname,
          doc.address_street,
          doc.address_number,
          doc.address_state,
          doc.address_country,
          doc.user_email,
          doc.phone_mobile,
          doc.active,
          doc.birthday,
          doc.role as any,
          doc.address_seed_token,
          doc.wallet_address_token,
          doc.did_user,
          doc.keycloak_sub,
          doc.apikeypok,
        ),
    );
  }

  /**
   * Busca por correo exacto. A diferencia de `findByEmail`, que es el buscador
   * incremental del front, acá no hay coincidencia parcial ni se exige que la
   * persona ya haya entrado: es la búsqueda que resuelve identidad, y quien
   * todavía no tiene identificador de Keycloak asociado es precisamente a quien
   * hay que encontrar.
   */
  async findOneByEmail(email: string): Promise<UserEntity | null> {
    const doc = await this.model.findOne({ user_email: email }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  /**
   * Refresca desde Keycloak al usuario que ya tiene ese identificador asociado.
   * El identificador de Keycloak es el ancla de la identidad, de modo que es
   * también el filtro. No inserta: si nadie lo tiene asociado, no hay a quién
   * refrescar y devuelve null.
   */
  async refreshFromKeycloak(
    payload: KeycloakSyncPayload,
  ): Promise<UserEntity | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { keycloak_sub: payload.keycloak_sub },
        { $set: this.keycloakFields(payload) },
        { new: true, runValidators: true },
      )
      .lean();

    return doc ? this.toEntity(doc) : null;
  }

  /**
   * Asocia un identificador de Keycloak a un usuario que ya existía sin él,
   * reconocido por el correo que el propio Keycloak trajo. Filtra por correo
   * porque el identificador todavía no está guardado, y no inserta: es una
   * asociación, no un alta. A partir de acá el ancla pasa a ser el
   * identificador de Keycloak.
   */
  async linkKeycloakIdentity(
    payload: KeycloakSyncPayload & { email: string },
  ): Promise<UserEntity | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { user_email: payload.email },
        {
          $set: {
            ...this.keycloakFields(payload),
            keycloak_sub: payload.keycloak_sub,
          },
        },
        { new: true, runValidators: true },
      )
      .lean();

    return doc ? this.toEntity(doc) : null;
  }

  private keycloakFields(payload: KeycloakSyncPayload) {
    return {
      user_email: payload.email,
      name: payload.name,
      surname: payload.surname,
      active: payload.active ?? true,
      role: payload.role,
    };
  }

  private toEntity(doc: PlainUser): UserEntity {
    return new UserEntity(
      doc.id_user,
      doc.id_organization,
      doc.name,
      doc.surname,
      doc.address_street,
      doc.address_number,
      doc.address_state,
      doc.address_country,
      doc.user_email,
      doc.phone_mobile,
      doc.active,
      doc.birthday,
      doc.role,
      doc.address_seed_token,
      doc.wallet_address_token,
      doc.did_user,
      doc.keycloak_sub,
      doc.apikeypok,
    );
  }

  async findByRole(role: string): Promise<UserEntity | null> {
    const doc = await this.model.findOne({ role: role }).lean();
    return doc
      ? new UserEntity(
          doc.id_user,
          doc.id_organization,
          doc.name,
          doc.surname,
          doc.address_street,
          doc.address_number,
          doc.address_state,
          doc.address_country,
          doc.user_email,
          doc.phone_mobile,
          doc.active,
          doc.birthday,
          doc.role as any,
          doc.address_seed_token,
          doc.wallet_address_token,
          doc.did_user,
          doc.keycloak_sub,
          doc.apikeypok,
        )
      : null;
  }
}
