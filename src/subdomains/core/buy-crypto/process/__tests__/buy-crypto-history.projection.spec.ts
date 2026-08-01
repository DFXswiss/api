import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyCryptoHistoryMapper } from 'src/subdomains/core/buy-crypto/process/dto/buy-crypto-history.mapper';
import {
  BUY_CRYPTO_BUY_HISTORY_PROJECTION,
  BUY_CRYPTO_HISTORY_RESPONSE_FIELDS,
  BUY_CRYPTO_ROUTE_HISTORY_PROJECTION,
  BuyCryptoRepository,
} from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyCrypto, BuyCryptoStatus } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
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

const SCHEMA = 'buy_crypto_history_projection_spec';

/**
 * `GET /buy/:id/history` and `GET /swap/:id/history` — the four levels from
 * `docs/read-path-projections.md`.
 *
 * Both answer a `HistoryDtoDeprecated[]` built by the same mapper, and both reached it through a
 * `find` that loads whole `BuyCrypto` rows: 497 and 509 columns respectively, for the ten values the
 * mapper reads. They differ only in the route they filter by — `buy` for one, `cryptoRoute` for the
 * other — which is why there are two projections over one field list.
 */
describeProjection('buy-crypto history — read-path projection', () => {
  let dataSource: DataSource;
  let repository: BuyCryptoRepository;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
    repository = new BuyCryptoRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /**
   * A completed transaction on a buy route, with every column of every entity populated.
   *
   * `blockchain` and `status` are set explicitly: both are TypeScript enums stored in text columns,
   * so a generated value would be a string no mapper knows, and the response would look incomplete
   * for a reason that has nothing to do with the projection.
   */
  async function seedBuyCrypto(
    status = BuyCryptoStatus.COMPLETE,
  ): Promise<{ buyCrypto: BuyCrypto; user: User; buy: Buy }> {
    const user = await seedEntity<User>(dataSource, User);
    const buy = await seedEntity<Buy>(dataSource, Buy, { values: { user } });
    const outputAsset = await seedEntity<Asset>(dataSource, Asset, { values: { blockchain: Blockchain.ETHEREUM } });
    const buyCrypto = await seedEntity<BuyCrypto>(dataSource, BuyCrypto, { values: { buy, outputAsset, status } });
    return { buyCrypto, user, buy };
  }

  /** The same, on a swap route. */
  async function seedSwapCrypto(): Promise<{ buyCrypto: BuyCrypto; user: User; route: Swap }> {
    const user = await seedEntity<User>(dataSource, User);
    const route = await seedEntity<Swap>(dataSource, Swap, { values: { user } });
    const outputAsset = await seedEntity<Asset>(dataSource, Asset, { values: { blockchain: Blockchain.ETHEREUM } });
    const buyCrypto = await seedEntity<BuyCrypto>(dataSource, BuyCrypto, {
      values: { cryptoRoute: route, outputAsset, status: BuyCryptoStatus.COMPLETE },
    });
    return { buyCrypto, user, route };
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — the buy history answers with no empty field', async () => {
    const { user, buy } = await seedBuyCrypto();

    const history = (await repository.findBuyHistory(user.id, buy.id)).map(BuyCryptoHistoryMapper.toDto);

    expect(history).toHaveLength(1);
    expectNoEmptyFields(history);
  }, 120000);

  it('level 1 — the swap history answers with no empty field', async () => {
    const { user, route } = await seedSwapCrypto();

    const history = (await repository.findSwapHistory(user.id, route.id)).map(BuyCryptoHistoryMapper.toDto);

    expect(history).toHaveLength(1);
    expectNoEmptyFields(history);
  }, 120000);

  // --- LEVEL 2: variants --- //

  it('level 2 — a transaction without an output asset still answers', async () => {
    const user = await seedEntity<User>(dataSource, User);
    const buy = await seedEntity<Buy>(dataSource, Buy, { values: { user } });
    await seedEntity<BuyCrypto>(dataSource, BuyCrypto, {
      values: { buy, outputAsset: null, status: BuyCryptoStatus.WAITING_FOR_LOWER_FEE },
    });

    const history = (await repository.findBuyHistory(user.id, buy.id)).map(BuyCryptoHistoryMapper.toDto);

    // The mapper guards on `outputAsset` for both the asset name and the explorer link, so a
    // pending transaction has neither. Everything the transaction itself carries must still be there
    // — a projection that only ever ran against a completed row would not show that.
    expect(history).toHaveLength(1);
    expect(history[0].outputAsset).toBeUndefined();
    expect(history[0].txUrl).toBeUndefined();
    expectNoEmptyFields(history, ['[0].outputAsset', '[0].txUrl']);
  }, 120000);

  it('level 2 — the route filter selects only the caller’s own transactions', async () => {
    const mine = await seedBuyCrypto();
    const other = await seedBuyCrypto();

    const history = (await repository.findBuyHistory(mine.user.id, mine.buy.id)).map(BuyCryptoHistoryMapper.toDto);

    expect(history).toHaveLength(1);
    expect(history[0].txId).toEqual(mine.buyCrypto.txId);
    expect(history[0].txId).not.toEqual(other.buyCrypto.txId);
  }, 120000);

  // --- LEVEL 3: mutation --- //

  it('level 3 — every field feeding the buy history is required', async () => {
    const { user, buy } = await seedBuyCrypto();

    await expectEveryFieldRequired(BUY_CRYPTO_HISTORY_RESPONSE_FIELDS, (omitted) =>
      repository
        .findBuyHistory(user.id, buy.id, projectionFieldsWithout(BUY_CRYPTO_BUY_HISTORY_PROJECTION.fields, omitted))
        .then((rows) => rows.map(BuyCryptoHistoryMapper.toDto)),
    );
  }, 300000);

  it('level 3 — every field feeding the swap history is required', async () => {
    const { user, route } = await seedSwapCrypto();

    await expectEveryFieldRequired(BUY_CRYPTO_HISTORY_RESPONSE_FIELDS, (omitted) =>
      repository
        .findSwapHistory(
          user.id,
          route.id,
          projectionFieldsWithout(BUY_CRYPTO_ROUTE_HISTORY_PROJECTION.fields, omitted),
        )
        .then((rows) => rows.map(BuyCryptoHistoryMapper.toDto)),
    );
  }, 300000);

  // --- LEVEL 4: consistency against a second source --- //

  it('level 4 — the projected buy history equals the one from a full load', async () => {
    const { user, buy } = await seedBuyCrypto();

    const projected = (await repository.findBuyHistory(user.id, buy.id)).map(BuyCryptoHistoryMapper.toDto);
    // The unprojected load is the second source: it fetches every column, so what it produces is by
    // construction what the endpoint answered before the conversion.
    const full = await dataSource.getRepository(BuyCrypto).find({
      where: { buy: { id: buy.id, user: { id: user.id } } },
      relations: { buy: { user: true } },
    });

    expect(projected).toEqual(full.map(BuyCryptoHistoryMapper.toDto));
  }, 120000);

  it('level 4 — the projected swap history equals the one from a full load', async () => {
    const { user, route } = await seedSwapCrypto();

    const projected = (await repository.findSwapHistory(user.id, route.id)).map(BuyCryptoHistoryMapper.toDto);
    const full = await dataSource.getRepository(BuyCrypto).find({
      where: { cryptoRoute: { id: route.id, user: { id: user.id } } },
      relations: { cryptoRoute: { user: true } },
    });

    expect(projected).toEqual(full.map(BuyCryptoHistoryMapper.toDto));
  }, 120000);
});
