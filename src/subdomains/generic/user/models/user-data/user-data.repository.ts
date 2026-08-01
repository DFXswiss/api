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

/** The nine columns `UserDtoMapper.mapVolumes` reads, for either the account or one of its users. */
const volumeFields = (alias: string): string[] =>
  [
    'buyVolume',
    'annualBuyVolume',
    'monthlyBuyVolume',
    'sellVolume',
    'annualSellVolume',
    'monthlySellVolume',
    'cryptoVolume',
    'annualCryptoVolume',
    'monthlyCryptoVolume',
  ].map((field) => `${alias}.${field}`);

/**
 * What the account itself contributes to `UserDtoMapper.mapUser`.
 *
 * The address columns are not shown by this response; they are read by `isDataComplete`, which
 * answers `false` for any of them that the query did not load — a wrong value, not a missing one.
 * `country` and `organizationCountry` are relations, and the same getter tests them for truthiness,
 * so both are joined below for their primary key alone.
 */
export const USER_V2_ACCOUNT_FIELDS = [
  // The response keys itself by this: `mapUser` returns it as `accountId`.
  'userData.id',
  'userData.accountType',
  'userData.mail',
  'userData.phone',
  'userData.kycHash',
  // `kycLevelDisplay`, `tradingLimit` and `isKycTerminated` are getters over this and the limit.
  'userData.kycLevel',
  'userData.depositLimit',
  'userData.phoneCallAccepted',
  'userData.phoneCallStatus',
  // `phoneCallTimesObject` splits this column.
  'userData.phoneCallTimes',
  'userData.paymentLinksAllowed',
  'userData.apiKeyCT',
  'userData.apiFilterCT',
  ...volumeFields('userData'),
  // Read only by `isDataComplete`, together with the two joined countries.
  'userData.firstname',
  'userData.surname',
  'userData.street',
  'userData.location',
  'userData.zip',
  'userData.organizationName',
  'userData.organizationStreet',
  'userData.organizationLocation',
  'userData.organizationZip',
  // Relations, and `isDataComplete` tests them for truthiness like any other required field. They
  // are response fields rather than guards for exactly that reason: dropping either one changes the
  // answer, so the mutation test has to cover them.
  'country.id',
  'organizationCountry.id',
];

/** What `LanguageDtoMapper.entityToDto` and `FiatDtoMapper.toDto` read. */
export const USER_V2_LANGUAGE_AND_CURRENCY_FIELDS = [
  'language.id',
  'language.name',
  'language.symbol',
  'language.foreignName',
  'language.enable',
  'currency.id',
  'currency.name',
  'currency.buyable',
  'currency.sellable',
  'currency.instantBuyable',
  'currency.instantSellable',
];

/**
 * What `UserDtoMapper.mapAddress` reads off a user and its wallet.
 *
 * `user.status` drives `isBlockedOrDeleted`, which decides whether an address is listed as active or
 * as disabled; `wallet.name` and `user.address` are what the `blockchains` getter derives the chain
 * list from, and `wallet.usesDummyAddresses` hides an address entirely.
 */
export const USER_V2_ADDRESS_FIELDS = [
  'user.id',
  'user.label',
  'user.address',
  'user.ref',
  'user.apiKeyCT',
  'user.apiFilterCT',
  'user.role',
  'user.status',
  ...volumeFields('user'),
  'userWallet.name',
  'userWallet.displayName',
  'userWallet.usesDummyAddresses',
];

/**
 * `GET /user` (v2) — the widest read path left in the inventory.
 *
 * Without it a `findOne` on `UserData` selects 351 columns: four countries, a language, a currency
 * and an organization expand eagerly, and every user of the account brings its whole wallet.
 *
 * `computeCapabilities` reads `kycSteps` through `getStepsWith`. This query does not load that
 * relation and neither did the one before it, so the two capabilities derived from it do not depend
 * on the steps. The projection reproduces that; changing it would change the response.
 */
export const USER_V2_PROJECTION = new ReadProjection<UserData>(
  'userData',
  [
    ['userData.language', 'language'],
    ['userData.currency', 'currency'],
    ['userData.country', 'country'],
    ['userData.organizationCountry', 'organizationCountry'],
    ['userData.users', 'user'],
    ['user.wallet', 'userWallet'],
  ],
  [...USER_V2_ACCOUNT_FIELDS, ...USER_V2_LANGUAGE_AND_CURRENCY_FIELDS, ...USER_V2_ADDRESS_FIELDS],
  // Never shown: the status the endpoint refuses merged accounts on before it maps anything, and
  // the wallet key that makes the ORM materialise the joined row.
  ['userData.status', 'userWallet.id'],
);

/**
 * What `POST /user/apiKey/CT` reads.
 *
 * `apiKeyCT` is read twice: once to refuse a second key, and once after the new one is assigned,
 * because `ApiKeyService.getSecret` hashes it together with `created`.
 */
export const API_KEY_RESPONSE_FIELDS = [
  // The key is derived from the account id, and the secret from the key and the creation date.
  'userData.id',
  'userData.apiKeyCT',
  'userData.created',
];

/**
 * `POST /user/apiKey/CT` — 253 columns before, for two values and the id.
 *
 * The endpoint writes, but through `update(id, …)` rather than by saving the row it read, so a
 * projected read cannot blank a column it did not load.
 */
export const API_KEY_PROJECTION = new ReadProjection<UserData>(
  'userData',
  [],
  API_KEY_RESPONSE_FIELDS,
);

@Injectable()
export class UserDataRepository extends CachedRepository<UserData> {
  constructor(manager: EntityManager) {
    super(UserData, manager);
  }

  /**
   * The account, carrying what an API key is built from.
   *
   * `fields` is what the mutation tests in `user-profile.projection.spec.ts`, `user-v2.projection.spec.ts`
   * and `api-key.projection.spec.ts` re-run the query with; the services call these without it.
   */
  async getForApiKey(id: number, fields: ReadonlyArray<string> = API_KEY_PROJECTION.fields): Promise<UserData> {
    return API_KEY_PROJECTION.apply(this.createQueryBuilder('userData'), fields)
      .where('userData.id = :id', { id })
      .getOne();
  }

  /**
   * Loads exactly what the v2 user response needs, users and wallets included.
   *
   * `fields` is what the mutation tests in `user-profile.projection.spec.ts`, `user-v2.projection.spec.ts`
   * and `api-key.projection.spec.ts` re-run the query with; the services call these without it.
   */
  async getUserV2(id: number, fields: ReadonlyArray<string> = USER_V2_PROJECTION.fields): Promise<UserData> {
    return USER_V2_PROJECTION.apply(this.createQueryBuilder('userData'), fields)
      .where('userData.id = :id', { id })
      .getOne();
  }

  /**
   * Loads exactly what the profile response needs.
   *
   * `fields` is what the mutation tests in `user-profile.projection.spec.ts`, `user-v2.projection.spec.ts`
   * and `api-key.projection.spec.ts` re-run the query with; the services call these without it.
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
