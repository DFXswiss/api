import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  expectEveryFieldRequired,
  expectNoEmptyFields,
  projectionFieldsWithout,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { PaymentLink } from 'src/subdomains/core/payment-link/entities/payment-link.entity';
import {
  POS_LINK_PROJECTION,
  POS_LINK_RESPONSE_FIELDS,
  PaymentLinkRepository,
} from 'src/subdomains/core/payment-link/repositories/payment-link.repository';
import { C2BPaymentLinkService } from 'src/subdomains/core/payment-link/services/c2b-payment-link.service';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { PaymentLinkService } from 'src/subdomains/core/payment-link/services/payment-link.service';
import { PaymentQuoteService } from 'src/subdomains/core/payment-link/services/payment-quote.service';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { Organization } from 'src/subdomains/generic/user/models/organization/organization.entity';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { DepositRouteService } from 'src/subdomains/supporting/address-pool/route/deposit-route.service';
import { DataSource } from 'typeorm';

const SCHEMA = 'pos_link_projection_spec';

/**
 * `PUT /paymentLink/:id/pos` — the four levels from `docs/read-path-projections.md`.
 *
 * The link was loaded with its route, its user, the account and the account's organization: 513
 * columns for a URL built from one identifier and one access key.
 *
 * The endpoint is driven through `PaymentLinkService.createPosLinkAdmin` rather than through a
 * rebuilt query, so what these levels compare is the answer the endpoint gives. Its collaborators
 * are mocked except the repository under test; the account-side write goes through
 * `UserDataService`, which is asserted on rather than executed, and the write itself is covered
 * separately below.
 */
describeProjection('point-of-sale link — read-path projection', () => {
  let dataSource: DataSource;
  let paymentLinks: PaymentLinkRepository;
  let userDataService: UserDataService;
  let userData: UserDataRepository;
  let service: PaymentLinkService;

  beforeAll(async () => {
    // The URL prefix comes from the module-level Config.
    new ConfigService();
    dataSource = await createProjectionDataSource(SCHEMA);
    paymentLinks = new PaymentLinkRepository(dataSource.manager);
    userData = new UserDataRepository(dataSource.manager);
  }, 300000);

  beforeEach(() => {
    userDataService = createMock<UserDataService>();
    // `updatePaymentLinksConfig` is the one collaborator method that matters here: it receives the
    // projected account entity and re-reads `paymentLinksConfig` off it to merge into. Bound to a
    // real repository it runs for real, so a projection that dropped that column would reset the
    // account's configuration and this spec would see it.
    userDataService.updatePaymentLinksConfig = jest.fn((user, dto) =>
      UserDataService.prototype.updatePaymentLinksConfig.call({ userDataRepo: userData }, user, dto),
    );
    service = new PaymentLinkService(
      paymentLinks,
      createMock<PaymentLinkPaymentService>(),
      createMock<PaymentQuoteService>(),
      userDataService,
      createMock<DepositRouteService>(),
      createMock<C2BPaymentLinkService>(),
    );
  });

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /**
   * A link on a route of an account.
   *
   * `accountType` is set explicitly because `UserData.address` branches on it — the endpoint does
   * not read that address, and the organization fixture below is what shows that it does not.
   */
  async function seedLink(
    accountType = AccountType.PERSONAL,
    account: Partial<UserData> = {},
    link: Partial<PaymentLink> = {},
  ): Promise<{ paymentLink: PaymentLink; userData: UserData }> {
    const organization = await seedEntity<Organization>(dataSource, Organization);
    const userData = await seedEntity<UserData>(dataSource, UserData, {
      // `paymentLinksConfig` holds JSON and is read through `JSON.parse`; a generated string throws
      // before any assertion is reached.
      values: { organization, accountType, paymentLinksConfig: '{}', ...account },
    });
    const user = await seedEntity<User>(dataSource, User, { values: { userData } });
    // An active sell route carries a check constraint requiring a bank data row.
    const bankData = await seedEntity<BankData>(dataSource, BankData, { values: { userData } });
    const route = await seedEntity<Sell>(dataSource, Sell, { values: { user, active: true, bankData } });
    const paymentLink = await seedEntity<PaymentLink>(dataSource, PaymentLink, {
      values: { route, config: null, ...link },
    });
    return { paymentLink, userData };
  }

  /** A configuration carrying one access key, as the endpoint stores it. */
  const withKey = (key: string): string => JSON.stringify({ accessKeys: [key] });

  /**
   * The `key` parameter of the URL the endpoint answers with.
   *
   * Read off the query string rather than through `URL`: the prefix comes from the configuration
   * and is not necessarily absolute.
   */
  const keyOf = (url: string): string => {
    const key = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('key');
    if (key == null) throw new Error(`no key in ${url}`);

    return key;
  };

  /** The answer of the endpoint, through the projected query. */
  async function posLinkOf(
    id: number,
    scoped?: boolean,
    fields = POS_LINK_PROJECTION.fields,
  ): Promise<{ url: string; key: string }> {
    jest
      .spyOn(paymentLinks, 'findForPosLink')
      .mockImplementationOnce((linkId) =>
        POS_LINK_PROJECTION.apply(paymentLinks.createQueryBuilder('paymentLink'), fields)
          .where('paymentLink.id = :linkId', { linkId })
          .getOne(),
      );

    const url = await service.createPosLinkAdmin(id, scoped);

    return { url, key: keyOf(url) };
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — a link with a stored key answers with it', async () => {
    const { paymentLink } = await seedLink(AccountType.PERSONAL, {}, { config: withKey('stored-on-the-link') });

    const answer = await posLinkOf(paymentLink.id);

    expect(answer.key).toEqual('stored-on-the-link');
    expectNoEmptyFields(answer);
  }, 120000);

  // --- LEVEL 2: variants --- //

  it.each<[string, boolean | undefined]>([
    ['unset, which merges the account into the link', undefined],
    ['true, which reads the link alone', true],
  ])(
    'level 2 — with scoped %s the key comes from the link',
    async (_name, scoped) => {
      const { paymentLink } = await seedLink(AccountType.PERSONAL, {}, { config: withKey('from-the-link') });

      expect((await posLinkOf(paymentLink.id, scoped)).key).toEqual('from-the-link');
    },
    120000,
  );

  it.each<[string, boolean | undefined]>([
    ['unset, which merges the account into the link', undefined],
    ['false, which reads the account alone', false],
  ])(
    'level 2 — with scoped %s the key comes from the account',
    async (_name, scoped) => {
      const { paymentLink } = await seedLink(AccountType.PERSONAL, { paymentLinksConfig: withKey('from-the-account') });

      expect((await posLinkOf(paymentLink.id, scoped)).key).toEqual('from-the-account');
    },
    120000,
  );

  it('level 2 — a link that sets the keys to null overrides the account rather than falling back', async () => {
    // The merge is by spread, so a key the link carries wins even when its value is null. Without
    // this case the two configurations could be merged the other way round and every other variant
    // would still pass.
    const { paymentLink } = await seedLink(
      AccountType.PERSONAL,
      { paymentLinksConfig: withKey('from-the-account') },
      { config: JSON.stringify({ accessKeys: null }) },
    );

    const answer = await posLinkOf(paymentLink.id);

    // A freshly generated key rather than the account's: the link's null wins the merge, so the
    // endpoint finds no key at all and issues one.
    expect(answer.key).not.toEqual('from-the-account');
    expect(answer.key).toMatch(/^[0-9A-Z]{40,}$/);
  }, 120000);

  it.each([AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP])(
    'level 2 — a %s account answers without reading its address',
    async (accountType) => {
      // `configObj` assembles a recipient block the endpoint discards, and that block reads
      // `UserData.address`, a getter that switches to the organization row for these two account
      // types. The projection joins no organization — this is the case that shows it needs none.
      const { paymentLink } = await seedLink(accountType, {}, { config: withKey('regardless-of-address') });

      expect((await posLinkOf(paymentLink.id)).key).toEqual('regardless-of-address');
    },
    120000,
  );

  it('level 2 — a link without a stored key gets one, written to the link', async () => {
    const { paymentLink } = await seedLink();

    const answer = await posLinkOf(paymentLink.id, true);

    const stored = await dataSource.getRepository(PaymentLink).findOneBy({ id: paymentLink.id });
    expect(JSON.parse(stored.config).accessKeys).toEqual([answer.key]);
  }, 120000);

  it('level 2 — the unscoped branch writes through the account service instead', async () => {
    const { paymentLink, userData } = await seedLink();

    const answer = await posLinkOf(paymentLink.id, false);

    expect(userDataService.updatePaymentLinksConfig).toHaveBeenCalledWith(
      expect.objectContaining({ id: userData.id }),
      {
        accessKeys: [answer.key],
      },
    );
  }, 120000);

  it('level 2 — an unknown id is refused', async () => {
    const { paymentLink } = await seedLink();

    await expect(posLinkOf(paymentLink.id + 1_000_000)).rejects.toThrow('Payment link not found');
  }, 120000);

  // --- LEVEL 3: mutation --- //

  /** The fields each configuration source contributes, keyed by the fixture that reads it. */
  const LINK_FIELDS = ['paymentLink.uniqueId', 'paymentLink.config'];
  const ACCOUNT_FIELDS = ['paymentLink.uniqueId', 'posUserData.paymentLinksConfig'];

  // Only one of the two configurations is consulted per call, so each is a candidate in the fixture
  // that reads it and not in the other — dropping the unread one changes nothing, which is true and
  // proves nothing.
  it.each([
    ['the link', undefined, { config: withKey('mutation-link') }, {}, LINK_FIELDS],
    ['the account', false, {}, { paymentLinksConfig: withKey('mutation-account') }, ACCOUNT_FIELDS],
  ] as [string, boolean, Partial<PaymentLink>, Partial<UserData>, string[]][])(
    'level 3 — with the key on %s every field feeding the answer is required',
    async (_name, scoped, link, account, candidates) => {
      const { paymentLink } = await seedLink(AccountType.PERSONAL, account, link);

      await expectEveryFieldRequired(candidates, (omitted) =>
        posLinkOf(paymentLink.id, scoped, projectionFieldsWithout(POS_LINK_PROJECTION.fields, omitted)),
      );
    },
    300000,
  );

  it('level 3 — the two fixtures together cover every field of the projection', () => {
    // Splitting the candidates per fixture is only sound if nothing falls between them.
    expect([...new Set([...LINK_FIELDS, ...ACCOUNT_FIELDS])].sort()).toEqual([...POS_LINK_RESPONSE_FIELDS].sort());
  });

  // --- the claim that makes this endpoint convertible at all --- //

  it.each([
    ['the link', 'payment_link', 'config'],
    ['the account', 'user_data', 'paymentLinksConfig'],
  ])(
    'writing %s after a projected read leaves every other column untouched',
    async (_name, table, column) => {
      // This is the whole reason a write endpoint can be converted: both updates name their columns,
      // so neither can blank the ones the projection left out. Saving a loaded row back would.
      const { paymentLink, userData } = await seedLink();
      const id = table === 'payment_link' ? paymentLink.id : userData.id;
      const rowOf = async (): Promise<Record<string, unknown>> =>
        (await dataSource.query(`SELECT * FROM "${SCHEMA}"."${table}" WHERE id = $1`, [id]))[0];
      const before = await rowOf();

      const loaded = await paymentLinks.findForPosLink(paymentLink.id);
      const written = withKey('written-key');
      if (table === 'payment_link') await paymentLinks.update(loaded.id, { config: written });
      else await dataSource.getRepository(UserData).update(loaded.route.userData.id, { paymentLinksConfig: written });

      const after = await rowOf();
      expect(after[column]).toEqual(written);

      const ignored = [column, 'updated'];
      const comparable = (row: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(Object.entries(row).filter(([name]) => !ignored.includes(name)));

      expect(comparable(after)).toEqual(comparable(before));
    },
    120000,
  );

  it('keeps the existing configuration when the write adds an access key to the link', async () => {
    // The scoped write merges the new key into what was read, so this is the failure the projection
    // could cause: a `config` it did not load hands the merge an empty object, and the stored
    // configuration is replaced by nothing but the key. Run end to end for that reason.
    const { paymentLink } = await seedLink(
      AccountType.PERSONAL,
      {},
      // Both values differ from the defaults: the merge strips anything equal to them, which is
      // the service's own behaviour and would make an equal value look lost.
      { config: JSON.stringify({ fee: 0.9, paymentTimeout: 12345 }) },
    );

    const answer = await posLinkOf(paymentLink.id, true);

    const stored = JSON.parse((await dataSource.getRepository(PaymentLink).findOneBy({ id: paymentLink.id })).config);
    expect(stored.accessKeys).toEqual([answer.key]);
    expect(stored.fee).toEqual(0.9);
    expect(stored.paymentTimeout).toEqual(12345);
  }, 120000);

  it('keeps the existing configuration when the write adds an access key to the account', async () => {
    // The unscoped branch merges on the account side, out of the projected entity it is handed —
    // `updatePaymentLinksConfig` re-reads `paymentLinksConfig` off that entity. A projection missing
    // the column would hand it an empty object and replace the account's configuration with nothing
    // but the new key, which is why that method runs for real here.
    const { paymentLink, userData: account } = await seedLink(AccountType.PERSONAL, {
      paymentLinksConfig: JSON.stringify({ fee: 0.4 }),
    });

    const answer = await posLinkOf(paymentLink.id, false);

    const stored = JSON.parse(
      (await dataSource.getRepository(UserData).findOneBy({ id: account.id })).paymentLinksConfig,
    );
    expect(stored.accessKeys).toEqual([answer.key]);
    expect(stored.fee).toEqual(0.4);
  }, 120000);

  it('loads the two ids the endpoint scopes its updates by', async () => {
    // Neither appears in the answer, so no level would notice their absence — and both updates are
    // scoped by them.
    const { paymentLink, userData } = await seedLink();

    const loaded = await paymentLinks.findForPosLink(paymentLink.id);

    expect(loaded.id).toEqual(paymentLink.id);
    expect(loaded.route.userData.id).toEqual(userData.id);
  }, 120000);

  // --- LEVEL 4: consistency against a second source --- //

  it.each([AccountType.PERSONAL, AccountType.ORGANIZATION])(
    'level 4 — for %s the projected answer equals the one from a full load',
    async (accountType) => {
      const { paymentLink } = await seedLink(accountType, {}, { config: withKey('same-either-way') });

      const projected = await posLinkOf(paymentLink.id);
      // The unprojected load is the second source: the same relations selected whole.
      jest.spyOn(paymentLinks, 'findForPosLink').mockImplementationOnce((id) =>
        paymentLinks.findOne({
          where: { id },
          relations: { route: { user: { userData: { organization: true } } } },
        }),
      );
      const full = await service.createPosLinkAdmin(paymentLink.id);

      expect(projected.url).toEqual(full);
    },
    120000,
  );
});
