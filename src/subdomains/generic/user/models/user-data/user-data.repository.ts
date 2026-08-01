import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { UserData } from './user-data.entity';
import { UserDataStatus } from './user-data.enum';

/** The fields `CountryDtoMapper.entityToDto` reads, for a given join alias. */
const countryFields = (alias: string): string[] =>
  [
    'id',
    'symbol',
    'name',
    'foreignName',
    'ipEnable',
    'fatfEnable',
    'dfxEnable',
    'dfxOrganizationEnable',
    'nationalityStepEnable',
    'bankEnable',
    'checkoutEnable',
    'cryptoEnable',
  ].map((field) => `${alias}.${field}`);

/**
 * Fields the profile response shows regardless of account type.
 *
 * `organization.name` belongs here rather than with the organization address: the mapper reads it
 * whenever an organization is linked, while only the *address* branches on `accountType`.
 */
export const USER_PROFILE_ACCOUNT_FIELDS = [
  'userData.accountType',
  'userData.firstname',
  'userData.surname',
  'userData.mail',
  'userData.phone',
  'organization.name',
];

/**
 * The address `UserData.address` returns for a personal account.
 *
 * The getter branches on `accountType`; a business account never reaches these, which is why the
 * mutation test asserts over one branch at a time.
 */
export const USER_PROFILE_PERSONAL_ADDRESS_FIELDS = [
  'userData.street',
  'userData.houseNumber',
  'userData.location',
  'userData.zip',
  ...countryFields('country'),
];

/** The address `UserData.address` returns for an organization or sole-proprietorship account. */
export const USER_PROFILE_ORGANIZATION_ADDRESS_FIELDS = [
  'organization.street',
  'organization.houseNumber',
  'organization.location',
  'organization.zip',
  ...countryFields('organizationCountry'),
];

/**
 * `GET /user/profile` — the seven values `UserDtoMapper.mapProfile` returns.
 *
 * Without it a `findOne` on `UserData` selects 253 columns across 8 eager joins, `organization`
 * among them. Covered by `user-profile.projection.spec.ts` on all four levels.
 */
export const USER_PROFILE_PROJECTION = new ReadProjection<UserData>(
  'userData',
  [
    ['userData.country', 'country'],
    ['userData.organization', 'organization'],
    ['organization.country', 'organizationCountry'],
  ],
  [
    ...USER_PROFILE_ACCOUNT_FIELDS,
    ...USER_PROFILE_PERSONAL_ADDRESS_FIELDS,
    ...USER_PROFILE_ORGANIZATION_ADDRESS_FIELDS,
  ],
  // Never part of the response: the primary keys that make the ORM materialise the joined rows, and
  // the status the endpoint refuses merged accounts on before it maps anything.
  ['userData.id', 'userData.status', 'organization.id'],
);

@Injectable()
export class UserDataRepository extends CachedRepository<UserData> {
  constructor(manager: EntityManager) {
    super(UserData, manager);
  }

  /**
   * Loads exactly what the profile response needs.
   *
   * `fields` exists for the mutation test, which re-runs this query with one field left out; nothing
   * in production passes it.
   */
  async getProfile(id: number, fields: ReadonlyArray<string> = USER_PROFILE_PROJECTION.fields): Promise<UserData> {
    return USER_PROFILE_PROJECTION.apply(this.createQueryBuilder('userData'), fields)
      .where('userData.id = :id', { id })
      .getOne();
  }

  async setNewUpdateTime(userDataId: number): Promise<void> {
    await this.update(userDataId, { updated: new Date() });
  }

  async activateUserData(userData: UserData, manager?: EntityManager): Promise<void> {
    if (userData.status === UserDataStatus.NA)
      await (manager?.getRepository(UserData) ?? this).update(userData.id, { status: UserDataStatus.ACTIVE });
  }
}
