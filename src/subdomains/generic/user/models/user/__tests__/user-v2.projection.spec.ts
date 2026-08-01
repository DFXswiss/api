import { ConfigService } from 'src/config/config';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  expectEveryFieldRequired,
  expectNoEmptyFields,
  projectionFieldsWithout,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { Country } from 'src/shared/models/country/country.entity';
import { UserDtoMapper } from 'src/subdomains/generic/user/models/user/dto/user-dto.mapper';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import {
  KycLevel,
  PhoneCallPreferredTime,
  PhoneCallStatus,
  UserDataStatus,
} from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import {
  USER_V2_ACCOUNT_FIELDS,
  USER_V2_ADDRESS_FIELDS,
  USER_V2_LANGUAGE_AND_CURRENCY_FIELDS,
  USER_V2_PROJECTION,
  UserDataRepository,
} from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { DataSource } from 'typeorm';

const SCHEMA = 'user_v2_projection_spec';

/**
 * Addresses have to look like addresses.
 *
 * `user.blockchains` derives the chain list from the address itself, and `explorerUrl` is built
 * from the first entry — a generated string belongs to no chain, so both come out empty and the
 * completeness assertion would report a projection problem where there is none.
 */
let addressCount = 0;
const nextEvmAddress = (): string => `0x${(++addressCount).toString(16).padStart(40, 'a')}`;

/**
 * `GET /user` (v2) — the four levels from `docs/read-path-projections.md`.
 *
 * The widest read path in the inventory: a `findOne` on `UserData` selected 351 columns, because
 * four countries, a language, a currency and an organization expand eagerly and every user of the
 * account brought its whole wallet.
 *
 * Most of what the response shows comes out of getters rather than columns, and several of them
 * answer a valid-looking value from a missing field: `isDataComplete` reports `false`, the trading
 * limit falls back to the no-KYC default. Level 3 therefore compares against the response the full
 * projection produced, not against emptiness.
 */
describeProjection('GET /user v2 — read-path projection', () => {
  let dataSource: DataSource;
  let userDataRepo: UserDataRepository;

  beforeAll(async () => {
    // `tradingLimit` reads the no-KYC default off the module-level Config.
    new ConfigService();
    dataSource = await createProjectionDataSource(SCHEMA);
    userDataRepo = new UserDataRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /**
   * An account with one address on it, every column populated.
   *
   * `accountType`, `kycLevel`, `status` and the user's `status` are set explicitly: all four are
   * TypeScript enums in text columns, and the mapper branches on each — a generated value lands in
   * the wrong branch and the response looks complete for the wrong reason.
   */
  async function seedAccount(
    account: Partial<UserData> = {},
    user: Partial<User> = {},
    wallet: Partial<Wallet> = {},
  ): Promise<{ userData: UserData; user: User }> {
    const language = await seedEntity<Language>(dataSource, Language);
    const currency = await seedEntity<Fiat>(dataSource, Fiat);
    const country = await seedEntity<Country>(dataSource, Country);
    const organizationCountry = await seedEntity<Country>(dataSource, Country);
    const userData = await seedEntity<UserData>(dataSource, UserData, {
      values: {
        language,
        currency,
        country,
        organizationCountry,
        accountType: AccountType.PERSONAL,
        kycLevel: KycLevel.LEVEL_50,
        status: UserDataStatus.ACTIVE,
        // Read through a lookup table, so a generated value maps to undefined and reads exactly
        // like a column the query failed to load.
        phoneCallStatus: PhoneCallStatus.COMPLETED,
        // Split on ';' by `phoneCallTimesObject`; a value has to be a member for the list to mean
        // anything.
        phoneCallTimes: PhoneCallPreferredTime.H_9_TO_10,
        ...account,
      },
    });
    const userWallet = await seedEntity<Wallet>(dataSource, Wallet, {
      values: { usesDummyAddresses: false, ...wallet },
    });
    const seeded = await seedEntity<User>(dataSource, User, {
      values: { userData, wallet: userWallet, status: UserStatus.ACTIVE, address: nextEvmAddress(), ...user },
    });
    return { userData, user: seeded };
  }

  /** The response the endpoint produces, through the projected query. */
  async function userV2Of(id: number, activeUserId?: number, fields = USER_V2_PROJECTION.fields) {
    const userData = await userDataRepo.getUserV2(id, fields);
    return UserDtoMapper.mapUser(userData, activeUserId);
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — a complete account answers with no empty field', async () => {
    const { userData, user } = await seedAccount();

    const dto = await userV2Of(userData.id, user.id);

    expect(dto.addresses).toHaveLength(1);
    // `disabledAddresses` is legitimately empty for an account with no blocked address; the case
    // where it is filled is covered below.
    expectNoEmptyFields(dto, ['disabledAddresses']);
  }, 120000);

  // --- LEVEL 2: variants --- //

  it('level 2 — an organization account answers with no empty field', async () => {
    // `requiredKycFields` swaps the personal name fields for the four organization address columns,
    // so a projection missing one of those is only visible on this account type.
    const { userData, user } = await seedAccount({ accountType: AccountType.ORGANIZATION });

    expectNoEmptyFields(await userV2Of(userData.id, user.id), ['disabledAddresses']);
  }, 120000);

  it.each([KycLevel.LEVEL_0, KycLevel.LEVEL_50, KycLevel.TERMINATED])(
    'level 2 — kycLevel %s answers with a trading limit',
    async (kycLevel) => {
      const { userData, user } = await seedAccount({ kycLevel });

      // The three branches of `tradingLimit` are a yearly limit, a zero limit for a terminated
      // account, and the configured default. Only the first reads the deposit limit and the volumes.
      const dto = await userV2Of(userData.id, user.id);

      expect(dto.tradingLimit.limit).toBeDefined();
      expect(dto.tradingLimit.period).toBeDefined();
    },
    120000,
  );

  it('level 2 — a blocked address is listed as disabled rather than active', async () => {
    const { userData } = await seedAccount({}, { status: UserStatus.BLOCKED });

    const dto = await userV2Of(userData.id);

    expect(dto.addresses).toHaveLength(0);
    expect(dto.disabledAddresses).toHaveLength(1);
  }, 120000);

  it('level 2 — an address on a dummy-address wallet is not listed at all', async () => {
    const { userData } = await seedAccount({}, {}, { usesDummyAddresses: true });

    const dto = await userV2Of(userData.id);

    expect(dto.addresses).toHaveLength(0);
    expect(dto.disabledAddresses).toHaveLength(0);
  }, 120000);

  it('level 2 — the active address is the one the caller authenticated with', async () => {
    const { userData, user } = await seedAccount();

    expect((await userV2Of(userData.id, user.id)).activeAddress?.address).toEqual(user.address);
    expect((await userV2Of(userData.id)).activeAddress).toBeUndefined();
  }, 120000);

  it('level 2 — the account answers only with its own addresses', async () => {
    const mine = await seedAccount();
    const other = await seedAccount();

    const dto = await userV2Of(mine.userData.id);

    expect(dto.addresses.map((a) => a.address)).toEqual([mine.user.address]);
    expect(dto.addresses.map((a) => a.address)).not.toContain(other.user.address);
  }, 120000);

  it('level 2 — an incomplete account reports dataComplete false', async () => {
    // The counter-case to level 1: with a required field genuinely absent the flag must be false,
    // which is what makes the level-1 assertion meaningful.
    const { userData, user } = await seedAccount({ street: null });

    expect((await userV2Of(userData.id, user.id)).kyc.dataComplete).toBe(false);
  }, 120000);

  // --- LEVEL 3: mutation --- //

  /** The account fields only an organization account reads. */
  const ORGANIZATION_ONLY = [
    'userData.organizationName',
    'userData.organizationStreet',
    'userData.organizationLocation',
    'userData.organizationZip',
    'organizationCountry.id',
  ];

  /**
   * Fields the mapper only reaches through a fallback, or through a branch a default fixture does
   * not enter. Each gets its own fixture below; against the default one they are droppable, which
   * is true and proves nothing.
   */
  const NEEDS_ITS_OWN_FIXTURE = [
    'user.apiKeyCT',
    'user.apiFilterCT',
    'user.role',
    'userWallet.name',
    'userWallet.usesDummyAddresses',
  ];

  const withoutFields = (fields: string[], excluded: string[]): string[] =>
    fields.filter((field) => !excluded.includes(field));

  /** Adds a second, blocked address so that `disabledAddresses` is populated as well. */
  async function seedBlockedAddress(userData: UserData): Promise<void> {
    const wallet = await seedEntity<Wallet>(dataSource, Wallet, { values: { usesDummyAddresses: false } });
    await seedEntity<User>(dataSource, User, {
      values: { userData, wallet, status: UserStatus.BLOCKED, address: nextEvmAddress() },
    });
  }

  it.each([
    ['personal', AccountType.PERSONAL, ORGANIZATION_ONLY],
    ['organization', AccountType.ORGANIZATION, []],
  ])(
    'level 3 — on a %s account every field feeding the response is required',
    async (_name, accountType, skipped) => {
      const { userData, user } = await seedAccount({ accountType });
      // The mutation run compares whole responses, and a list that is empty in the baseline can never
      // differ — so both address lists have to be populated.
      await seedBlockedAddress(userData);

      await expectEveryFieldRequired(
        withoutFields(
          [...USER_V2_ACCOUNT_FIELDS, ...USER_V2_LANGUAGE_AND_CURRENCY_FIELDS, ...USER_V2_ADDRESS_FIELDS],
          [...skipped, ...NEEDS_ITS_OWN_FIXTURE],
        ),
        (omitted) => userV2Of(userData.id, user.id, projectionFieldsWithout(USER_V2_PROJECTION.fields, omitted)),
      );
    },
    300000,
  );

  it('level 3 — the address falls back to its own key and its wallet name when the account has none', async () => {
    // `mapAddress` reads `userData.apiKeyCT ?? user.apiKeyCT` and `wallet.displayName ?? wallet.name`.
    // With the left-hand side set, the right-hand columns are never reached and look removable.
    const { userData, user } = await seedAccount({ apiKeyCT: null, apiFilterCT: null }, {}, { displayName: null });
    await seedBlockedAddress(userData);

    await expectEveryFieldRequired(
      ['user.apiKeyCT', 'user.apiFilterCT', 'userWallet.name'],
      (omitted) => userV2Of(userData.id, user.id, projectionFieldsWithout(USER_V2_PROJECTION.fields, omitted)),
      // The account-level key is what this fixture removes, so the two fields it feeds at the top of
      // the response are empty by construction — that is the state that makes the address fall back.
      ['apiKeyCT', 'apiFilterCT'],
    );
  }, 300000);

  it('level 3 — the custody role is required to report an address as custody', async () => {
    // `isCustody` compares the role against one value. On any other role, dropping the column
    // produces `undefined === CUSTODY` — false, the same answer, so only a custody address shows it.
    const { userData, user } = await seedAccount({}, { role: UserRole.CUSTODY });

    await expectEveryFieldRequired(
      ['user.role'],
      (omitted) => userV2Of(userData.id, user.id, projectionFieldsWithout(USER_V2_PROJECTION.fields, omitted)),
      // With one custody address and none blocked, this list is empty by contract.
      ['disabledAddresses'],
    );
  }, 300000);

  it('level 3 — the dummy-address flag is required to hide an address', async () => {
    // The flag hides the address entirely. Dropping the column leaves it undefined, which is falsy,
    // so the address reappears — visible only on a wallet where the flag is actually set.
    const { userData, user } = await seedAccount({}, {}, { usesDummyAddresses: true });

    await expectEveryFieldRequired(
      ['userWallet.usesDummyAddresses'],
      (omitted) => userV2Of(userData.id, user.id, projectionFieldsWithout(USER_V2_PROJECTION.fields, omitted)),
      // Both lists are empty while the address is hidden — that is the state under test.
      ['addresses', 'disabledAddresses', 'activeAddress'],
    );
  }, 300000);

  // --- LEVEL 4: consistency against a second source --- //

  it.each([
    ['a personal account', AccountType.PERSONAL, UserStatus.ACTIVE],
    ['an organization account', AccountType.ORGANIZATION, UserStatus.ACTIVE],
    ['an account whose address is blocked', AccountType.PERSONAL, UserStatus.BLOCKED],
  ])(
    'level 4 — for %s the projected response equals the one from a full load',
    async (_name, accountType, status) => {
      const { userData, user } = await seedAccount({ accountType }, { status });

      const projected = await userV2Of(userData.id, user.id);
      // The unprojected load is the second source: the find the endpoint used before, with every
      // eager relation it pulls in.
      const full = await dataSource.getRepository(UserData).findOne({
        where: { id: userData.id },
        relations: { users: { wallet: true } },
      });

      expect(projected).toEqual(UserDtoMapper.mapUser(full, user.id));
    },
    120000,
  );
});
