import { Asset } from 'src/shared/models/asset/asset.entity';
import {
  CUSTODY_ORDER_HISTORY_PROJECTION,
  CUSTODY_ORDER_HISTORY_RESPONSE_FIELDS,
} from 'src/subdomains/core/custody/repositories/custody-order.repository';
import { CustodyOrder } from 'src/subdomains/core/custody/entities/custody-order.entity';
import { CustodyOrderHistoryDtoMapper } from 'src/subdomains/core/custody/mappers/custody-order-history-dto.mapper';
import { CustodyOrderStatus, CustodyOrderType } from 'src/subdomains/core/custody/enums/custody';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
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

const SCHEMA = 'custody_order_history_projection_spec';

/**
 * `GET /custody/order` — the four levels from `docs/read-path-projections.md`.
 *
 * The query joined both assets and the transaction request with `leftJoinAndSelect`, loading each
 * of them whole — 19 columns for two names and two amounts.
 */
describeProjection('GET /custody/order — read-path projection', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /**
   * One order of a user, with every column populated.
   *
   * `type` and `status` are set explicitly: both are TypeScript enums in text columns, and the
   * mapper switches on them — a generated value lands in the default branch.
   */
  async function seedOrder(
    type = CustodyOrderType.DEPOSIT,
    status = CustodyOrderStatus.COMPLETED,
    withAmounts = true,
  ): Promise<{ order: CustodyOrder; userData: UserData }> {
    const userData = await seedEntity<UserData>(dataSource, UserData);
    const user = await seedEntity<User>(dataSource, User, { values: { userData } });
    const inputAsset = await seedEntity<Asset>(dataSource, Asset);
    const outputAsset = await seedEntity<Asset>(dataSource, Asset);
    const transactionRequest = await seedEntity<TransactionRequest>(dataSource, TransactionRequest);
    const order = await seedEntity<CustodyOrder>(dataSource, CustodyOrder, {
      // Without its own amounts the order falls back to the request it came from — the only state in
      // which the two transactionRequest columns reach the response.
      values: {
        user,
        inputAsset,
        outputAsset,
        transactionRequest,
        type,
        status,
        ...(withAmounts ? {} : { inputAmount: null, outputAmount: null }),
      },
    });
    return { order, userData };
  }

  /** The response the endpoint produces, through the projected query. */
  async function historyOf(userDataId: number, fields = CUSTODY_ORDER_HISTORY_PROJECTION.fields) {
    const orders = await CUSTODY_ORDER_HISTORY_PROJECTION.apply(
      dataSource.getRepository(CustodyOrder).createQueryBuilder('custodyOrder'),
      fields,
    )
      .innerJoin('custodyOrder.user', 'user')
      .innerJoin('user.userData', 'userData')
      .where('userData.id = :userDataId', { userDataId })
      .andWhere('custodyOrder.status != :createdStatus', { createdStatus: CustodyOrderStatus.CREATED })
      .getMany();
    return CustodyOrderHistoryDtoMapper.mapList(orders);
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — a completed order answers with no empty field', async () => {
    const { userData } = await seedOrder();

    const history = await historyOf(userData.id);

    expect(history).toHaveLength(1);
    expectNoEmptyFields(history);
  }, 120000);

  // --- LEVEL 2: variants --- //

  it.each([
    [CustodyOrderType.DEPOSIT, CustodyOrderStatus.CONFIRMED],
    [CustodyOrderType.WITHDRAWAL, CustodyOrderStatus.CONFIRMED],
    [CustodyOrderType.SWAP, CustodyOrderStatus.IN_PROGRESS],
    [CustodyOrderType.WITHDRAWAL, CustodyOrderStatus.FAILED],
  ])(
    'level 2 — %s / %s answers with no empty field',
    async (type, status) => {
      const { userData } = await seedOrder(type, status);

      // `mapStatus` reads type and status together, and the incoming/outgoing split only shows on a
      // confirmed order. `inputAmount` and `outputAmount` fall back to the transaction request for
      // incoming and swap orders, so both directions have to be covered.
      expectNoEmptyFields(await historyOf(userData.id));
    },
    120000,
  );

  it('level 2 — an order still in creation is not listed', async () => {
    const { userData } = await seedOrder(CustodyOrderType.DEPOSIT, CustodyOrderStatus.CREATED);

    expect(await historyOf(userData.id)).toHaveLength(0);
  }, 120000);

  it('level 2 — a user sees only their own orders', async () => {
    const mine = await seedOrder();
    const other = await seedOrder();

    const history = await historyOf(mine.userData.id);

    expect(history).toHaveLength(1);
    expect(history[0].created).toEqual(mine.order.created);
    expect(history[0].created).not.toEqual(other.order.created);
  }, 120000);

  // --- LEVEL 3: mutation --- //

  const REQUEST_FALLBACK = ['transactionRequest.estimatedAmount', 'transactionRequest.amount'];

  it.each([
    // With its own amounts set, an order never reads the request — those two columns are covered by
    // the row below, where the fallback is the only source the response has.
    [
      CustodyOrderType.DEPOSIT,
      true,
      CUSTODY_ORDER_HISTORY_RESPONSE_FIELDS.filter((f) => !REQUEST_FALLBACK.includes(f)),
    ],
    [
      CustodyOrderType.WITHDRAWAL,
      true,
      CUSTODY_ORDER_HISTORY_RESPONSE_FIELDS.filter((f) => !REQUEST_FALLBACK.includes(f)),
    ],
    [CustodyOrderType.SWAP, false, REQUEST_FALLBACK],
  ] as [CustodyOrderType, boolean, string[]][])(
    'level 3 — for %s with own amounts=%s every field feeding the response is required',
    async (type, withAmounts, candidates) => {
      const { userData } = await seedOrder(type, CustodyOrderStatus.CONFIRMED, withAmounts);

      await expectEveryFieldRequired(
        candidates,
        (omitted) => historyOf(userData.id, projectionFieldsWithout(CUSTODY_ORDER_HISTORY_PROJECTION.fields, omitted)),
        withAmounts ? [] : ['[0].inputAmount', '[0].outputAmount'],
      );
    },
    300000,
  );

  // --- LEVEL 4: consistency against a second source --- //

  it.each([
    [CustodyOrderType.DEPOSIT, CustodyOrderStatus.COMPLETED],
    [CustodyOrderType.SWAP, CustodyOrderStatus.CONFIRMED],
    [CustodyOrderType.WITHDRAWAL, CustodyOrderStatus.FAILED],
  ])(
    'level 4 — for %s / %s the projected response equals the one from a full load',
    async (type, status) => {
      const { userData } = await seedOrder(type, status);

      const projected = await historyOf(userData.id);
      // The unprojected load is the second source: `leftJoinAndSelect` on the three relations, which
      // is what the query did before the conversion.
      const full = await dataSource
        .getRepository(CustodyOrder)
        .createQueryBuilder('custodyOrder')
        .leftJoinAndSelect('custodyOrder.inputAsset', 'inputAsset')
        .leftJoinAndSelect('custodyOrder.outputAsset', 'outputAsset')
        .leftJoinAndSelect('custodyOrder.transactionRequest', 'transactionRequest')
        .innerJoin('custodyOrder.user', 'user')
        .innerJoin('user.userData', 'userData')
        .where('userData.id = :userDataId', { userDataId: userData.id })
        .andWhere('custodyOrder.status != :createdStatus', { createdStatus: CustodyOrderStatus.CREATED })
        .getMany();

      expect(projected).toEqual(CustodyOrderHistoryDtoMapper.mapList(full));
    },
    120000,
  );
});
