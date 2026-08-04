import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import {
  BUY_FIAT_HISTORY_PROJECTION,
  BUY_FIAT_HISTORY_RESPONSE_FIELDS,
  BuyFiatRepository,
} from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatHistoryMapper } from 'src/subdomains/core/sell-crypto/process/dto/buy-fiat-history.mapper';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { FiatOutput } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
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

const SCHEMA = 'buy_fiat_history_projection_spec';

/**
 * `GET /sell/:id/history` — the four levels from `docs/read-path-projections.md`.
 *
 * The endpoint answers a `SellHistoryDto[]`. Reading it without a projection loads whole `BuyFiat`
 * rows for the nine values the mapper reads.
 */
describeProjection('GET /sell/:id/history — read-path projection', () => {
  let dataSource: DataSource;
  let repository: BuyFiatRepository;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
    repository = new BuyFiatRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /**
   * A paid-out transaction on a sell route, with every column populated.
   *
   * `blockchain` is set explicitly: it is a TypeScript enum in a text column, and the explorer link
   * the mapper builds resolves to `undefined` for anything that is not a member.
   */
  async function seedBuyFiat(withFiatOutput = true): Promise<{ buyFiat: BuyFiat; user: User; sell: Sell }> {
    const user = await seedEntity<User>(dataSource, User);
    // An active sell route must carry a bankData — a check constraint on `deposit_route` enforces
    // it, and a route with transactions on it is active by definition.
    const bankData = await seedEntity<BankData>(dataSource, BankData);
    const sell = await seedEntity<Sell>(dataSource, Sell, { values: { user, bankData } });
    const asset = await seedEntity<Asset>(dataSource, Asset, { values: { blockchain: Blockchain.ETHEREUM } });
    const cryptoInput = await seedEntity<CryptoInput>(dataSource, CryptoInput, { values: { asset } });
    const fiatOutput = withFiatOutput ? await seedEntity<FiatOutput>(dataSource, FiatOutput) : null;
    // The fixture sets `outputAsset` because the mapper dereferences it without a guard, although
    // the column is nullable. What happens without one is the mapper's behaviour, not the
    // projection's, and this file does not change either.
    const outputAsset = await seedEntity<Fiat>(dataSource, Fiat);
    const buyFiat = await seedEntity<BuyFiat>(dataSource, BuyFiat, {
      values: { sell, cryptoInput, fiatOutput, outputAsset },
    });
    return { buyFiat, user, sell };
  }

  /** A second sell route of the same user, with one transaction on it. */
  async function seedSecondRouteFor(user: User): Promise<{ buyFiat: BuyFiat; sell: Sell }> {
    const bankData = await seedEntity<BankData>(dataSource, BankData);
    const sell = await seedEntity<Sell>(dataSource, Sell, { values: { user, bankData } });
    const asset = await seedEntity<Asset>(dataSource, Asset, { values: { blockchain: Blockchain.ETHEREUM } });
    const cryptoInput = await seedEntity<CryptoInput>(dataSource, CryptoInput, { values: { asset } });
    const fiatOutput = await seedEntity<FiatOutput>(dataSource, FiatOutput);
    const outputAsset = await seedEntity<Fiat>(dataSource, Fiat);
    const buyFiat = await seedEntity<BuyFiat>(dataSource, BuyFiat, {
      values: { sell, cryptoInput, fiatOutput, outputAsset },
    });
    return { buyFiat, sell };
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — the sell history answers with no empty field', async () => {
    const { user, sell } = await seedBuyFiat();

    const history = (await repository.findSellHistory(user.id, sell.id)).map(BuyFiatHistoryMapper.toDto);

    expect(history).toHaveLength(1);
    expectNoEmptyFields(history);
  }, 120000);

  // --- LEVEL 2: variants --- //

  it('level 2 — a transaction not yet paid out answers without a date', async () => {
    const { user, sell } = await seedBuyFiat(false);

    const history = (await repository.findSellHistory(user.id, sell.id)).map(BuyFiatHistoryMapper.toDto);

    // `fiatOutput` is the nullable one of the four joins. The date is the only field it feeds, so
    // everything else must still be complete — otherwise a left join was written as an inner one.
    expect(history).toHaveLength(1);
    expect(history[0].date).toBeUndefined();
    expectNoEmptyFields(history, ['[0].date']);
  }, 120000);

  it('level 2 — both the user and the route filter are needed to select the right transactions', async () => {
    // Two fixtures with a user and a route each are not enough: asking with one user's id and that
    // user's route id, either predicate on its own still returns exactly the expected row. The
    // second route below makes the route id necessary, and the foreign route makes the user id
    // necessary — dropping either one then changes the answer.
    const mine = await seedBuyFiat();
    const second = await seedSecondRouteFor(mine.user);
    const other = await seedBuyFiat();

    const onOneRoute = (await repository.findSellHistory(mine.user.id, mine.sell.id)).map(BuyFiatHistoryMapper.toDto);
    expect(onOneRoute.map((row) => row.inputAmount)).toEqual([mine.buyFiat.inputAmount]);
    expect(onOneRoute.map((row) => row.inputAmount)).not.toContain(second.buyFiat.inputAmount);

    // Without a route the caller gets every route they own, and still nothing of anyone else's.
    const allOfMine = (await repository.findSellHistory(mine.user.id)).map(BuyFiatHistoryMapper.toDto);
    expect(allOfMine.map((row) => row.inputAmount).sort()).toEqual(
      [mine.buyFiat.inputAmount, second.buyFiat.inputAmount].sort(),
    );

    // A foreign route asked for with this caller's id resolves to nothing: the user predicate is
    // what refuses it.
    expect(await repository.findSellHistory(mine.user.id, other.sell.id)).toHaveLength(0);
  }, 120000);

  // --- LEVEL 3: mutation --- //

  it('level 3 — every field feeding the response is required', async () => {
    const { user, sell } = await seedBuyFiat();

    await expectEveryFieldRequired(BUY_FIAT_HISTORY_RESPONSE_FIELDS, (omitted) =>
      repository
        .findSellHistory(user.id, sell.id, projectionFieldsWithout(BUY_FIAT_HISTORY_PROJECTION.fields, omitted))
        .then((rows) => rows.map(BuyFiatHistoryMapper.toDto)),
    );
  }, 300000);

  // --- LEVEL 4: consistency against a second source --- //

  it.each([true, false])(
    'level 4 — with fiatOutput=%s the projected response equals the one from a full load',
    async (withFiatOutput) => {
      const { user, sell } = await seedBuyFiat(withFiatOutput);

      const projected = (await repository.findSellHistory(user.id, sell.id)).map(BuyFiatHistoryMapper.toDto);
      // The unprojected load is the second source: it fetches every column, so what it produces
      // depends on no field list at all.
      const full = await dataSource.getRepository(BuyFiat).find({
        where: { sell: { id: sell.id, user: { id: user.id } } },
        relations: { sell: { user: true }, cryptoInput: true, fiatOutput: true },
      });

      expect(projected).toEqual(full.map(BuyFiatHistoryMapper.toDto));
    },
    120000,
  );
});
