import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import {
  SUPPORT_ISSUE_DATA_ACCOUNT_FIELDS,
  SUPPORT_ISSUE_DATA_ISSUE_FIELDS,
  SUPPORT_ISSUE_DATA_LIMIT_REQUEST_FIELDS,
  SUPPORT_ISSUE_DATA_PROJECTION,
  SUPPORT_ISSUE_DATA_TRANSACTION_FIELDS,
  SupportIssueRepository,
} from 'src/subdomains/supporting/support-issue/repositories/support-issue.repository';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportIssueDtoMapper } from 'src/subdomains/supporting/support-issue/dto/support-issue-dto.mapper';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { LimitRequest } from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
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

const SCHEMA = 'support_issue_data_projection_spec';

/**
 * `GET /support/issue/:id/data` — the four levels from `docs/read-path-projections.md`.
 *
 * The widest read path in the service: the unprojected load reaches 951 columns for a response of
 * about sixty values, because the issue's four eager relations expand recursively and the
 * transaction pulls in both of its sides.
 *
 * The branch worth testing is `mapTransactionData`, which reads `buyCrypto ?? buyFiat`. A projection
 * covering only one of the two answers 200 with an empty transaction block for every issue on the
 * other.
 */
describeProjection('GET /support/issue/:id/data — read-path projection', () => {
  let dataSource: DataSource;
  let repository: SupportIssueRepository;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
    repository = new SupportIssueRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /** A crypto input whose asset carries a blockchain the explorer knows. */
  async function seedCryptoInput(): Promise<CryptoInput> {
    const asset = await seedEntity<Asset>(dataSource, Asset, { values: { blockchain: Blockchain.ETHEREUM } });
    return seedEntity<CryptoInput>(dataSource, CryptoInput, { values: { asset } });
  }

  /**
   * An issue with a transaction on the requested side, and everything else populated.
   *
   * `named` picks which side of two fallback chains the fixture exercises. `UserData.completeName`
   * is `organizationName ?? firstname + surname`, and the wallet name is `displayName ?? name`: with
   * the first alternative present the second never runs, so one fixture can only ever show that half
   * of those fields are needed. Setting the first to `null` is what makes the rest load-bearing.
   */
  async function seedIssue(
    side: 'buyCrypto' | 'buyFiat' | 'none',
    named: 'organization' | 'personal' = 'organization',
  ): Promise<SupportIssue> {
    const personal = named === 'personal';
    const userData = await seedEntity<UserData>(dataSource, UserData, {
      values: personal ? { organizationName: null } : {},
      relations: { country: true, language: true },
    });
    let transaction: Transaction = null;
    if (side !== 'none') {
      // The wallet block of the response hangs off `transaction.user.wallet`, and both are nullable
      // in the schema — a fixture without them says nothing about those four fields.
      const wallet = await seedEntity<Wallet>(dataSource, Wallet, {
        values: personal ? { displayName: null } : {},
      });
      const user = await seedEntity<User>(dataSource, User, { values: { userData, wallet } });
      transaction = await seedEntity<Transaction>(dataSource, Transaction, { values: { userData, user } });
      if (side === 'buyCrypto') {
        const outputAsset = await seedEntity<Asset>(dataSource, Asset, { values: { blockchain: Blockchain.ETHEREUM } });
        await seedEntity<BuyCrypto>(dataSource, BuyCrypto, {
          values: { transaction, outputAsset, cryptoInput: await seedCryptoInput() },
        });
      } else {
        const outputAsset = await seedEntity<Fiat>(dataSource, Fiat);
        // An active sell route must carry a bankData; a check constraint on `deposit_route`
        // enforces it, and `BuyFiat.sell` is not nullable.
        const bankData = await seedEntity<BankData>(dataSource, BankData);
        const sell = await seedEntity<Sell>(dataSource, Sell, { values: { user, bankData } });
        await seedEntity<BuyFiat>(dataSource, BuyFiat, {
          values: { transaction, outputAsset, sell, cryptoInput: await seedCryptoInput() },
        });
      }
    }
    const limitRequest = await seedEntity<LimitRequest>(dataSource, LimitRequest);
    return seedEntity<SupportIssue>(dataSource, SupportIssue, {
      values: {
        userData,
        transaction,
        limitRequest,
        // Every field the transactionMissing block reports, so that an empty one means the column
        // was not loaded rather than never written.
        information: JSON.stringify({ senderIban: 'CH10', receiverIban: 'CH20', date: '2024-01-01' }),
      },
    });
  }

  /** The response the endpoint produces, through the projected query. */
  async function issueDataOf(id: number, fields = SUPPORT_ISSUE_DATA_PROJECTION.fields, hideLimitRequest = false) {
    const issue = await repository.findIssueData(id, fields);
    return SupportIssueDtoMapper.mapSupportIssueData(issue, hideLimitRequest);
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — an issue on a buy transaction answers with no empty field', async () => {
    const issue = await seedIssue('buyCrypto');

    expectNoEmptyFields(await issueDataOf(issue.id));
  }, 120000);

  // --- LEVEL 2: variants --- //

  it('level 2 — an issue on a sell transaction reads the other side', async () => {
    const issue = await seedIssue('buyFiat');

    const data = await issueDataOf(issue.id);

    // The fiat side has no output blockchain: its output asset is a currency, not a token. That is
    // the one field the two sides do not share, so it is the one exception here.
    expect(data.transaction.outputBlockchain).toBeUndefined();
    expectNoEmptyFields(data, ['transaction.outputBlockchain']);
  }, 120000);

  it('level 2 — an issue without a transaction answers without a transaction block', async () => {
    const issue = await seedIssue('none');

    const data = await issueDataOf(issue.id);

    // `mapTransactionData` returns undefined when there is no transaction id. Everything the issue
    // and the account carry must still be complete — otherwise a left join was written as an inner
    // one, and every issue raised without a transaction would 404 or come back empty.
    expect(data.transaction).toBeUndefined();
    expectNoEmptyFields(data, ['transaction']);
  }, 120000);

  it('level 2 — the limit request is withheld from support staff but the rest is not', async () => {
    const issue = await seedIssue('buyCrypto');

    const hidden = await issueDataOf(issue.id, SUPPORT_ISSUE_DATA_PROJECTION.fields, true);

    // The role decides whether the mapper runs, not what the query loads — so hiding it must not
    // take anything else with it.
    expect(hidden.limitRequest).toBeUndefined();
    expectNoEmptyFields(hidden, ['limitRequest']);
  }, 120000);

  it('level 2 — an issue with no additional information answers without that block', async () => {
    const userData = await seedEntity<UserData>(dataSource, UserData, {
      relations: { country: true, language: true },
    });
    const limitRequest = await seedEntity<LimitRequest>(dataSource, LimitRequest);
    const issue = await seedEntity<SupportIssue>(dataSource, SupportIssue, {
      values: { userData, transaction: null, limitRequest, information: null },
    });

    const data = await issueDataOf(issue.id);

    expect(data.transactionMissing).toBeUndefined();
    expectNoEmptyFields(data, ['transaction', 'transactionMissing']);
  }, 120000);

  // --- LEVEL 3: mutation --- //

  // Two response values are fed by a fallback chain, so the chain is the candidate rather than each
  // of its columns: `completeName` is `organizationName ?? firstname + surname`, and the wallet name
  // is `displayName ?? name`. Dropping any single column leaves the value filled by the next
  // alternative — true of every one of them, and therefore no evidence about any of them.
  const COMPLETE_NAME_CHAIN = ['userData.organizationName', 'userData.firstname', 'userData.surname'];
  const WALLET_NAME_CHAIN = ['transactionUserWallet.displayName', 'transactionUserWallet.name'];
  const CHAINED = [...COMPLETE_NAME_CHAIN, ...WALLET_NAME_CHAIN];

  it.each([
    [
      'buyCrypto',
      'organization',
      [
        ...[
          ...SUPPORT_ISSUE_DATA_ISSUE_FIELDS,
          ...SUPPORT_ISSUE_DATA_ACCOUNT_FIELDS,
          ...SUPPORT_ISSUE_DATA_LIMIT_REQUEST_FIELDS,
          ...SUPPORT_ISSUE_DATA_TRANSACTION_FIELDS.filter((field) => !field.startsWith('buyFiat')),
        ].filter((field) => !CHAINED.includes(field)),
        COMPLETE_NAME_CHAIN,
        WALLET_NAME_CHAIN,
      ],
    ],
    [
      'buyFiat',
      'organization',
      SUPPORT_ISSUE_DATA_TRANSACTION_FIELDS.filter(
        (field) => field.startsWith('buyFiat') && field !== 'buyFiatOutputAsset.blockchain',
      ),
    ],
    // The row above asserts the two chains as groups, which is all a fixture that fills the first
    // alternative can do. On an account without an organization name and a wallet without a display
    // name the fallbacks fire, and the columns behind them become individually required.
    ['buyCrypto', 'personal', ['userData.firstname', 'userData.surname', 'transactionUserWallet.name']],
  ] as ['buyCrypto' | 'buyFiat', 'organization' | 'personal', (string | string[])[]][])(
    'level 3 — for a %s transaction on a %s account every field feeding the response is required',
    async (side, named, candidates) => {
      const issue = await seedIssue(side, named);
      // The fiat fixture reaches only the fiat side of the mapper, so the crypto fields are asserted
      // by the crypto row and vice versa — dropping the other side's fields here would prove nothing.
      const optional = side === 'buyFiat' ? ['transaction.outputBlockchain'] : [];

      await expectEveryFieldRequired(
        candidates,
        (omitted) => issueDataOf(issue.id, projectionFieldsWithout(SUPPORT_ISSUE_DATA_PROJECTION.fields, omitted)),
        optional,
      );
    },
    300000,
  );

  // --- LEVEL 4: consistency against a second source --- //

  it.each([
    ['buyCrypto', 'organization'],
    ['buyFiat', 'organization'],
    ['none', 'organization'],
    // Both fallback chains take their second alternative here, which is a different response shape
    // than the three rows above produce.
    ['buyCrypto', 'personal'],
  ] as ['buyCrypto' | 'buyFiat' | 'none', 'organization' | 'personal'][])(
    'level 4 — for a %s issue on a %s account the projected response equals the one from a full load',
    async (side, named) => {
      const issue = await seedIssue(side, named);

      const projected = await issueDataOf(issue.id);
      // The unprojected load is the second source: the relation set the endpoint used before the
      // conversion, fetching every column of each.
      const full = await dataSource.getRepository(SupportIssue).findOne({
        where: { id: issue.id },
        relations: {
          userData: { country: true, language: true },
          transaction: {
            user: { wallet: true },
            buyCrypto: { outputAsset: true, cryptoInput: { asset: true } },
            buyFiat: { outputAsset: true, cryptoInput: { asset: true } },
          },
          limitRequest: true,
        },
        loadEagerRelations: false,
      });

      expect(projected).toEqual(SupportIssueDtoMapper.mapSupportIssueData(full, false));
    },
    120000,
  );

  // --- the projection must not lose what the endpoint checks before mapping --- //

  it('loads the account id the customer scope is enforced on', async () => {
    const issue = await seedIssue('buyCrypto');

    const loaded = await repository.findIssueData(issue.id);

    // `getIssueData` answers 404 when the issue does not belong to a scoped customer, and reads
    // `issue.userData?.id` to decide. Losing it would open every issue to every tenant.
    expect(loaded.userData?.id).toEqual(issue.userData.id);
  }, 120000);
});
