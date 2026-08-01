import { ConfigService } from 'src/config/config';
import { Country } from 'src/shared/models/country/country.entity';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  expectEveryFieldRequired,
  expectNoEmptyFields,
  projectionFieldsWithout,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { PaymentLinkConfig } from 'src/subdomains/core/payment-link/entities/payment-link.config';
import { PaymentLink } from 'src/subdomains/core/payment-link/entities/payment-link.entity';
import {
  POS_LINK_PROJECTION,
  POS_LINK_RESPONSE_FIELDS,
  PaymentLinkRepository,
} from 'src/subdomains/core/payment-link/repositories/payment-link.repository';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { Organization } from 'src/subdomains/generic/user/models/organization/organization.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { DataSource } from 'typeorm';

const SCHEMA = 'pos_link_projection_spec';

/**
 * `PUT /paymentLink/:id/pos` — the four levels from `docs/read-path-projections.md`.
 *
 * The link was loaded with its route, its user, the account and the account's organization, which
 * came to 513 columns for a recipient block and two configuration strings.
 *
 * The endpoint writes as well as reads, but only through `update(id, …)` — it never saves the row
 * it read — so a projected read cannot blank a column it did not load. What it can do is lose the
 * existing configuration, because the write merges into it; `config` is asserted here for that.
 */
describeProjection('point-of-sale link — read-path projection', () => {
  let dataSource: DataSource;
  let paymentLinks: PaymentLinkRepository;

  beforeAll(async () => {
    // The recipient defaults come from the module-level Config.
    new ConfigService();
    dataSource = await createProjectionDataSource(SCHEMA);
    paymentLinks = new PaymentLinkRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /**
   * A link on a route of an account.
   *
   * `accountType` is set explicitly: it is a TypeScript enum in a text column and `UserData.address`
   * branches on it, so a generated value silently selects the personal address on an account whose
   * data lives on the organization.
   */
  async function seedLink(
    accountType = AccountType.PERSONAL,
    account: Partial<UserData> = {},
    link: Partial<PaymentLink> = {},
  ): Promise<{ paymentLink: PaymentLink; userData: UserData }> {
    const country = await seedEntity<Country>(dataSource, Country);
    const organizationCountry = await seedEntity<Country>(dataSource, Country);
    const organization = await seedEntity<Organization>(dataSource, Organization, {
      values: { country: organizationCountry },
    });
    const userData = await seedEntity<UserData>(dataSource, UserData, {
      // `paymentLinksConfig` holds JSON and is read through `JSON.parse`; a generated string throws
      // before any assertion is reached.
      values: { country, organization, accountType, paymentLinksConfig: '{}', ...account },
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

  /**
   * The three configuration sources the endpoint can answer from, as the service reads them.
   *
   * `scoped` selects between them: unset merges the account and the link, `true` takes the link
   * alone, `false` the account alone.
   */
  async function posConfigOf(
    id: number,
    fields = POS_LINK_PROJECTION.fields,
  ): Promise<{
    merged: PaymentLinkConfig;
    linkOnly: PaymentLinkConfig;
    accountOnly: PaymentLinkConfig;
    uniqueId: string;
    storedConfig: string;
  }> {
    const link = await paymentLinks.findForPosLink(id, fields);
    return {
      merged: link.configObj,
      linkOnly: link.linkConfigObj,
      accountOnly: link.route.userData.paymentLinksConfigObj,
      uniqueId: link.uniqueId,
      // What the write merges into. A projection that dropped it would reset the configuration.
      storedConfig: link.config,
    };
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — a link answers with a complete recipient', async () => {
    const { paymentLink } = await seedLink();

    const config = await posConfigOf(paymentLink.id);

    expect(config.merged.recipient).toBeDefined();
    expectNoEmptyFields(config.merged.recipient);
    expect(config.uniqueId).toBeDefined();
  }, 120000);

  // --- LEVEL 2: variants --- //

  it.each([AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP])(
    'level 2 — on a %s account the recipient address comes from the organization',
    async (accountType) => {
      const { paymentLink, userData } = await seedLink(accountType);

      const config = await posConfigOf(paymentLink.id);

      // `UserData.address` switches rows entirely for these two account types. Reading the personal
      // columns here would answer with an address that belongs to the wrong entity.
      expect(config.merged.recipient.address.street).toEqual(userData.organization.street);
      expect(config.merged.recipient.address.street).not.toEqual(userData.street);
      expectNoEmptyFields(config.merged.recipient);
    },
    120000,
  );

  it('level 2 — an account without a country answers without an address block', async () => {
    const { paymentLink } = await seedLink(AccountType.PERSONAL, { country: null });

    // The address is emitted only when the country is there; the rest of the recipient must stay.
    const config = await posConfigOf(paymentLink.id);

    expect(config.merged.recipient.address).toBeUndefined();
    expect(config.merged.recipient.mail).toBeDefined();
  }, 120000);

  it('level 2 — the link configuration overrides the account configuration', async () => {
    const { paymentLink } = await seedLink(
      AccountType.PERSONAL,
      { paymentLinksConfig: JSON.stringify({ recipient: { name: 'from-account' } }) },
      { config: JSON.stringify({ recipient: { name: 'from-link' } }) },
    );

    const config = await posConfigOf(paymentLink.id);

    expect(config.merged.recipient.name).toEqual('from-link');
    expect(config.linkOnly.recipient.name).toEqual('from-link');
    expect(config.accountOnly.recipient.name).toEqual('from-account');
    expect(config.storedConfig).toContain('from-link');
  }, 120000);

  // --- LEVEL 3: mutation --- //

  /** The five address columns of the account, read only for a personal account. */
  const PERSONAL_ADDRESS = [
    'posUserData.street',
    'posUserData.houseNumber',
    'posUserData.location',
    'posUserData.zip',
    'posCountry.symbol',
  ];

  /** The same five, read off the organization for the other account types. */
  const ORGANIZATION_ADDRESS = [
    'posOrganization.street',
    'posOrganization.houseNumber',
    'posOrganization.location',
    'posOrganization.zip',
    'posOrganizationCountry.symbol',
  ];

  /**
   * The name, which is `organizationName` falling back to the two personal ones.
   *
   * Typed as a mutation candidate: a group of fields is one candidate, because dropping any single
   * member leaves the value filled by the next alternative.
   */
  const NAME_FIELDS: string[] = ['posUserData.organizationName', 'posUserData.firstname', 'posUserData.surname'];

  /**
   * Two configurations that differ from the defaults and from each other, so both columns are
   * required — set on `fee` rather than on `recipient`, which would mask the columns the recipient
   * is built from and make them look removable.
   */
  const ACCOUNT_CONFIG = JSON.stringify({ fee: 0.5 });
  const LINK_CONFIG = JSON.stringify({ fee: 0.7 });

  it.each([
    // `UserData.address` reads one row or the other, never both, so the unread half is droppable for
    // the account type at hand — and covered by the other row of this table.
    // `accountType` is skipped for the personal row for the same reason: dropped it reads
    // undefined, which is not one of the two organization types either, so the branch and the
    // answer are unchanged. The organization row is where it becomes visible.
    ['personal', AccountType.PERSONAL, [...ORGANIZATION_ADDRESS, 'posUserData.accountType']],
    ['organization', AccountType.ORGANIZATION, PERSONAL_ADDRESS],
  ])(
    'level 3 — on a %s account every field feeding the answer is required',
    async (_name, accountType, skipped) => {
      const { paymentLink } = await seedLink(
        accountType,
        { paymentLinksConfig: ACCOUNT_CONFIG },
        { config: LINK_CONFIG },
      );

      const candidates: (string | string[])[] = POS_LINK_RESPONSE_FIELDS.filter(
        // The name falls back, so no single one of its three columns is required here; the case
        // below is the one that reaches the fallback.
        (field) => !skipped.includes(field) && !NAME_FIELDS.includes(field),
      );

      await expectEveryFieldRequired([...candidates, NAME_FIELDS], (omitted) =>
        posConfigOf(paymentLink.id, projectionFieldsWithout(POS_LINK_PROJECTION.fields, omitted)),
      );
    },
    300000,
  );

  it('level 3 — the personal name is required when the account has no organization name', async () => {
    // `completeName` is `organizationName ?? firstname + surname`. With the organization name set,
    // the two personal columns are unreachable and report as removable — true, and useless.
    const { paymentLink } = await seedLink(
      AccountType.PERSONAL,
      { organizationName: null, paymentLinksConfig: ACCOUNT_CONFIG },
      { config: LINK_CONFIG },
    );

    await expectEveryFieldRequired(['posUserData.firstname', 'posUserData.surname'], (omitted) =>
      posConfigOf(paymentLink.id, projectionFieldsWithout(POS_LINK_PROJECTION.fields, omitted)),
    );
  }, 300000);

  // --- the projection must not lose the guards the write depends on --- //

  it('loads the two ids the endpoint scopes its updates by', async () => {
    // Neither appears in the answer, so no level would notice their absence — and both updates are
    // scoped by them: the link's own configuration and the account's payment-link configuration.
    const { paymentLink, userData } = await seedLink();

    const loaded = await paymentLinks.findForPosLink(paymentLink.id);

    expect(loaded.id).toEqual(paymentLink.id);
    expect(loaded.route.userData.id).toEqual(userData.id);
  }, 120000);

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
      const written = JSON.stringify({ accessKeys: ['written-key'] });
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

  it('carries the stored configuration verbatim, so the write has something to merge into', async () => {
    // The write merges the new access key into what was read. A projection that dropped `config`
    // would hand the merge an empty object and reset the configuration to just the key.
    const existing = JSON.stringify({ fee: 0.9, recipient: { name: 'existing' } });
    const { paymentLink } = await seedLink(AccountType.PERSONAL, {}, { config: existing });

    const loaded = await paymentLinks.findForPosLink(paymentLink.id);

    expect(loaded.config).toEqual(existing);
    expect(JSON.parse(loaded.config)).toEqual({ fee: 0.9, recipient: { name: 'existing' } });
  }, 120000);

  // --- LEVEL 4: consistency against a second source --- //

  it.each([AccountType.PERSONAL, AccountType.ORGANIZATION])(
    'level 4 — for %s the projected answer equals the one from a full load',
    async (accountType) => {
      const { paymentLink } = await seedLink(accountType);

      const projected = await posConfigOf(paymentLink.id);
      // The unprojected load is the second source: the relation set the endpoint used before.
      const full = await dataSource.getRepository(PaymentLink).findOne({
        where: { id: paymentLink.id },
        relations: { route: { user: { userData: { organization: true } } } },
      });

      expect(projected.merged).toEqual(full.configObj);
      expect(projected.linkOnly).toEqual(full.linkConfigObj);
      expect(projected.accountOnly).toEqual(full.route.userData.paymentLinksConfigObj);
      expect(projected.storedConfig).toEqual(full.config);
    },
    120000,
  );
});
