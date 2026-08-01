import { KycDataDtoMapper } from 'src/subdomains/generic/user/models/kyc/dto/kyc-data-dto.mapper';
import { KycStatus, KycType } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import {
  USER_KYC_FILES_PROJECTION,
  USER_KYC_FILES_RESPONSE_FIELDS,
  UserRepository,
} from 'src/subdomains/generic/user/models/user/user.repository';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import {
  WALLET_KYC_DATA_PROJECTION,
  WALLET_KYC_DATA_RESPONSE_FIELDS,
  WalletRepository,
} from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  expectEveryFieldRequired,
  expectNoEmptyFields,
  projectionFieldsWithout,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { DataSource } from 'typeorm';

const SCHEMA = 'kyc_data_projection_spec';

/**
 * `GET /kyc/users` and `GET /kyc/:id/documents` — the four levels from
 * `docs/read-path-projections.md`.
 *
 * Both loaded a whole row graph — 328 columns — for very little: the first for an address, two
 * status fields and a hash per user, the second for nothing but the account id the document store
 * is keyed by.
 */
describeProjection('kyc data — read-path projection', () => {
  let dataSource: DataSource;
  let wallets: WalletRepository;
  let users: UserRepository;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
    wallets = new WalletRepository(dataSource.manager);
    users = new UserRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /**
   * A wallet with one user on it.
   *
   * `kycStatus` and `kycType` are set explicitly: both are TypeScript enums in text columns, and
   * `getKycWebhookStatus` maps them by value — a generated string lands in the fallback branch and
   * would make the response look complete for the wrong reason.
   */
  async function seedWalletUser(
    kycStatus = KycStatus.COMPLETED,
    kycType = KycType.DFX,
  ): Promise<{ wallet: Wallet; user: User; userData: UserData }> {
    const wallet = await seedEntity<Wallet>(dataSource, Wallet);
    const userData = await seedEntity<UserData>(dataSource, UserData, { values: { kycStatus, kycType } });
    const user = await seedEntity<User>(dataSource, User, { values: { wallet, userData } });
    return { wallet, user, userData };
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — the kyc user list answers with no empty field', async () => {
    const { wallet } = await seedWalletUser();

    const loaded = await wallets.findKycData(wallet.id);

    expect(loaded.users).toHaveLength(1);
    expectNoEmptyFields(loaded.users.map(KycDataDtoMapper.toDto));
  }, 120000);

  it('level 1 — the document lookup loads the account id', async () => {
    const { user, userData } = await seedWalletUser();

    const loaded = await users.findAccountIdForAddress(user.address, user.wallet.id);

    expect(loaded?.userData?.id).toEqual(userData.id);
  }, 120000);

  // --- LEVEL 2: variants --- //

  it.each([
    [KycStatus.COMPLETED, KycType.LOCK],
    [KycStatus.REJECTED, KycType.DFX],
    [KycStatus.NA, KycType.DFX],
  ])(
    'level 2 — kycStatus %s with kycType %s answers with no empty field',
    async (kycStatus, kycType) => {
      const { wallet } = await seedWalletUser(kycStatus, kycType);

      const loaded = await wallets.findKycData(wallet.id);

      // `getKycWebhookStatus` branches on both values, and the LOCK/DFX split only shows on a
      // completed account. A fixture covering one combination says nothing about the others.
      expectNoEmptyFields(loaded.users.map(KycDataDtoMapper.toDto));
    },
    120000,
  );

  it('level 2 — a wallet answers only with its own users', async () => {
    const mine = await seedWalletUser();
    const other = await seedWalletUser();

    const loaded = await wallets.findKycData(mine.wallet.id);

    expect(loaded.users.map((u) => u.address)).toEqual([mine.user.address]);
    expect(loaded.users.map((u) => u.address)).not.toContain(other.user.address);
  }, 120000);

  it('level 2 — the document lookup is scoped to the wallet', async () => {
    const { user } = await seedWalletUser();
    const foreign = await seedWalletUser();

    // The address alone must not resolve: it is scoped to the wallet the caller authenticated with.
    expect(await users.findAccountIdForAddress(user.address, foreign.wallet.id)).toBeNull();
  }, 120000);

  // --- LEVEL 3: mutation --- //

  it.each([KycType.LOCK, KycType.DFX])(
    'level 3 — with kycType %s every field feeding the kyc user list is required',
    async (kycType) => {
      const { wallet } = await seedWalletUser(KycStatus.COMPLETED, kycType);
      // `kycType` only changes the answer on a completed account, and only for LOCK: the DFX branch
      // produces the same value the absent field would. One fixture therefore cannot show that the
      // column is needed — which is what the row above is for.
      const candidates =
        kycType === KycType.LOCK
          ? WALLET_KYC_DATA_RESPONSE_FIELDS
          : WALLET_KYC_DATA_RESPONSE_FIELDS.filter((field) => field !== 'walletUserData.kycType');

      await expectEveryFieldRequired(candidates, (omitted) =>
        wallets
          .findKycData(wallet.id, projectionFieldsWithout(WALLET_KYC_DATA_PROJECTION.fields, omitted))
          .then((loaded) => loaded.users.map(KycDataDtoMapper.toDto)),
      );
    },
    300000,
  );

  it('level 3 — the account id is required for the document lookup', async () => {
    const { user } = await seedWalletUser();

    await expectEveryFieldRequired(USER_KYC_FILES_RESPONSE_FIELDS, (omitted) =>
      users
        .findAccountIdForAddress(
          user.address,
          user.wallet.id,
          projectionFieldsWithout(USER_KYC_FILES_PROJECTION.fields, omitted),
        )
        .then((loaded) => ({ accountId: loaded?.userData?.id })),
    );
  }, 300000);

  // --- LEVEL 4: consistency against a second source --- //

  it.each([
    [KycStatus.COMPLETED, KycType.DFX],
    [KycStatus.COMPLETED, KycType.LOCK],
    [KycStatus.REJECTED, KycType.DFX],
  ])(
    'level 4 — for %s / %s the projected response equals the one from a full load',
    async (kycStatus, kycType) => {
      const { wallet } = await seedWalletUser(kycStatus, kycType);

      const projected = (await wallets.findKycData(wallet.id)).users.map(KycDataDtoMapper.toDto);
      // The unprojected load is the second source: the relation set the endpoint used before.
      const full = await dataSource.getRepository(Wallet).findOne({
        where: { id: wallet.id },
        relations: { users: { userData: true } },
      });

      expect(projected).toEqual(full.users.map(KycDataDtoMapper.toDto));
    },
    120000,
  );
});
