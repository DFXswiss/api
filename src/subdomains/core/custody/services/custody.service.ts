import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AmountType, Util } from 'src/shared/utils/util';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { AssetPrice } from 'src/subdomains/supporting/pricing/domain/entities/asset-price.entity';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import { In, IsNull, Not } from 'typeorm';
import { RefService } from '../../referral/process/ref.service';
import { CustodySignupDto } from '../dto/input/custody-signup.dto';
import { CustodyAuthDto } from '../dto/output/custody-auth.dto';
import { CustodyBalanceDto, CustodyHistoryDto, CustodyHistoryEntryDto } from '../dto/output/custody-balance.dto';
import { CustodyBalance } from '../entities/custody-balance.entity';
import { CustodyOrder } from '../entities/custody-order.entity';
import { CustodyOrderStatus } from '../enums/custody';
import { CustodyAssetBalanceDtoMapper } from '../mappers/custody-asset-balance-dto.mapper';
import { CustodyBalanceRepository } from '../repositories/custody-balance.repository';
import { CustodyOrderRepository } from '../repositories/custody-order.repository';

interface CustodyOrderSingle {
  asset: Asset;
  amount: number;
}

interface DailyFiatValue {
  chf: number;
  eur: number;
  usd: number;
}

@Injectable()
export class CustodyService {
  private readonly logger = new DfxLogger(CustodyService);

  constructor(
    private readonly userService: UserService,
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
    private readonly walletService: WalletService,
    private readonly refService: RefService,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
    private readonly custodyOrderRepo: CustodyOrderRepository,
    private readonly custodyBalanceRepo: CustodyBalanceRepository,
    private readonly assetPricesService: AssetPricesService,
    private readonly assetService: AssetService,
  ) {}

  // --- ACCOUNT --- //
  async createCustodyAccount(accountId: number, dto: CustodySignupDto, userIp: string): Promise<CustodyAuthDto> {
    const ref = await this.refService.get(userIp);
    if (ref) dto.usedRef ??= ref.ref;

    const wallet =
      (await this.walletService.getByIdOrName(undefined, dto.wallet)) ?? (await this.walletService.getDefault());

    const addressIndex = await this.userService.getNexCustodyIndex();
    const custodyWallet = EvmUtil.createWallet(Config.blockchain.evm.custodyAccount(addressIndex));
    const signature = await custodyWallet.signMessage(Config.auth.signMessageGeneral + custodyWallet.address);

    const account = await this.userDataService.getActiveUserData(accountId, { users: true });

    const custodyUser = await this.userService.createUser(
      {
        address: custodyWallet.address,
        signature,
        usedRef: dto.usedRef,
        ip: userIp,
        origin: ref?.origin,
        wallet,
        userData: account,
        custodyAddressType: dto.addressType,
        custodyAddressIndex: addressIndex,
        role: UserRole.CUSTODY,
      },
      dto.specialCode,
      dto.moderator,
    );

    return { accessToken: this.authService.generateUserToken(custodyUser, userIp) };
  }

  // --- BALANCE --- //
  async getUserCustodyBalance(accountId: number): Promise<CustodyBalanceDto> {
    const account = await this.userDataService.getUserData(accountId, { users: true });
    if (!account) throw new NotFoundException('User not found');

    const custodyUserIds = account.users.filter((u) => u.role === UserRole.CUSTODY).map((u) => u.id);
    const custodyBalances = await this.custodyBalanceRepo.findBy({ user: { id: In(custodyUserIds) } });

    const savingBalance = custodyBalances.find((b) => b.asset.uniqueName === Config.custody.savingAsset);
    const interestByAssetName = new Map<string, { interest: number; asset: Asset }>();
    if (savingBalance) {
      // dueDate is a parameter on calculateAccruedInterest for deterministic tests; runtime uses now.
      const interest = await this.calculateAccruedInterest(custodyUserIds, savingBalance.asset, new Date());
      // Keyed by asset.name, not asset.id: the mapper groups custody balances by asset.name (one
      // position can span multiple chains under the same symbol — see Util.groupByAccessor
      // below), so this lookup key must be the same identity the mapper groups by. The Asset
      // itself travels along too, so the mapper prices interestValue with the asset the interest
      // actually accrued on, never with an arbitrary same-named group representative.
      interestByAssetName.set(savingBalance.asset.name, { interest, asset: savingBalance.asset });
    }

    const balances = CustodyAssetBalanceDtoMapper.mapCustodyBalances(custodyBalances, interestByAssetName);

    const totalValueInEur = balances.reduce((prev, curr) => prev + curr.value.eur, 0);
    const totalValueInChf = balances.reduce((prev, curr) => prev + curr.value.chf, 0);
    const totalValueInUsd = balances.reduce((prev, curr) => prev + curr.value.usd, 0);

    return {
      balances,
      totalValue: {
        eur: Util.roundReadable(totalValueInEur, AmountType.FIAT),
        chf: Util.roundReadable(totalValueInChf, AmountType.FIAT),
        usd: Util.roundReadable(totalValueInUsd, AmountType.FIAT),
      },
    };
  }

  async createCustodyBalance(balance: number, user: User, asset: Asset): Promise<CustodyBalance> {
    const entity = this.custodyBalanceRepo.create({ user, asset, balance });

    return this.custodyBalanceRepo.save(entity);
  }

  async updateCustodyBalanceForOrder(order: CustodyOrder): Promise<void> {
    if (order.inputAsset) await this.updateCustodyBalance(order.inputAsset, order.user);
    if (order.outputAsset) await this.updateCustodyBalance(order.outputAsset, order.user);
  }

  async updateCustodyBalance(asset: Asset, user: User): Promise<void> {
    const { deposit } = await this.custodyOrderRepo
      .createQueryBuilder('custodyOrder')
      .select('SUM(custodyOrder.inputAmount)', 'deposit')
      .where('custodyOrder.userId = :id', { id: user.id })
      .andWhere('custodyOrder.status = :status', { status: CustodyOrderStatus.COMPLETED })
      .andWhere('custodyOrder.inputAssetId = :asset', { asset: asset.id })
      .getRawOne<{ deposit: number }>();

    const { withdrawal } = await this.custodyOrderRepo
      .createQueryBuilder('custodyOrder')
      .select('SUM(custodyOrder.outputAmount)', 'withdrawal')
      .where('custodyOrder.userId = :id', { id: user.id })
      .andWhere('custodyOrder.outputAssetId = :asset', { asset: asset.id })
      .andWhere('custodyOrder.status = :status', { status: CustodyOrderStatus.COMPLETED })
      .getRawOne<{ withdrawal: number }>();

    const balance = deposit - withdrawal;

    const custodyBalance = await this.custodyBalanceRepo.findOneBy({
      asset: { id: asset.id },
      user: { id: user.id },
    });

    if (!custodyBalance) {
      await this.createCustodyBalance(balance, user, asset);
    } else {
      await this.custodyBalanceRepo.update(custodyBalance.id, { balance });
    }
  }

  // --- HISTORY --- //
  async getUserCustodyHistory(accountId: number): Promise<CustodyHistoryDto> {
    const account = await this.userDataService.getUserData(accountId, { users: true });
    if (!account) throw new NotFoundException('User not found');

    // get completed orders (by date and asset)
    const custodyUserIds = account.users.filter((u) => u.role === UserRole.CUSTODY).map((u) => u.id);
    const custodyOrders = await this.custodyOrderRepo.find({
      where: { user: { id: In(custodyUserIds) }, status: CustodyOrderStatus.COMPLETED },
      order: { updated: 'ASC' },
    });

    if (!custodyOrders.length) return { totalValue: [] };

    const orderMap = custodyOrders.reduce((map, order) => {
      const key = Util.isoDate(order.updated);
      const dayMap = map.get(key) ?? new Map<number, CustodyOrderSingle[]>();

      [
        { asset: order.inputAsset, amount: order.inputAmount },
        { asset: order.outputAsset, amount: -order.outputAmount },
      ]
        .filter((o) => o.asset)
        .forEach((o) => dayMap.set(o.asset.id, (dayMap.get(o.asset.id) ?? []).concat([o])));

      return map.set(key, dayMap);
    }, new Map<string, Map<number, CustodyOrderSingle[]>>());

    // get all assets (unique)
    const allAssets = custodyOrders
      .map((o) => [o.inputAsset, o.outputAsset])
      .flat()
      .filter((a) => a);
    const assets = Array.from(new Map(allAssets.map((a) => [a.id, a])).values());

    // get all prices (by date)
    const startDate = new Date(custodyOrders[0].updated);
    startDate.setHours(0, 0, 0, 0);
    const prices = await this.assetPricesService.getAssetPrices(assets, startDate);

    const priceMap = Util.groupByAccessor(prices, (p) => Util.isoDate(p.created));

    // process by day: apply order volumes before calculating value
    const assetBalancesMap = new Map<number, number>();
    const totalValue: CustodyHistoryEntryDto[] = [];
    const sortedOrderDays = [...orderMap.keys()].sort();
    let orderDayIndex = 0;

    for (const [day, dayPrices] of priceMap.entries()) {
      // apply all order balance changes up to and including this day
      while (orderDayIndex < sortedOrderDays.length && sortedOrderDays[orderDayIndex] <= day) {
        const dayOrders = orderMap.get(sortedOrderDays[orderDayIndex]);
        if (dayOrders) {
          for (const [assetId, orders] of dayOrders.entries()) {
            const currentBalance = assetBalancesMap.get(assetId) ?? 0;
            assetBalancesMap.set(assetId, currentBalance + Util.sum(orders.map((o) => o.amount)));
          }
        }
        orderDayIndex++;
      }

      // calculate daily portfolio value from current balances and available prices
      const dailyValue = this.calculateDailyPortfolioValue(dayPrices, assetBalancesMap);

      totalValue.push({
        date: new Date(day),
        value: {
          chf: Util.roundReadable(dailyValue.chf, AmountType.FIAT),
          eur: Util.roundReadable(dailyValue.eur, AmountType.FIAT),
          usd: Util.roundReadable(dailyValue.usd, AmountType.FIAT),
        },
      });
    }

    return { totalValue };
  }

  /**
   * Accrued simple interest for an interest-bearing custody position.
   * dueDate is a parameter (not new Date() inside) so the method is deterministically testable.
   * Order type is intentionally not filtered — any completed order that moves the asset counts.
   * Value date is order.completedAt, an immutable timestamp set exactly once when an order
   * becomes Completed — see CustodyOrder.applyCompletedAt(), the single source of truth used
   * by CustodyOrderService.createOrderInternal(), updateCustodyOrderInternal(), and
   * CustodyOrder.complete(). order.updated cannot serve this role: it is a TypeORM
   * @UpdateDateColumn overwritten on every .save(), including harmless re-saves of an
   * already-Completed order — that would silently push the interest start date forward.
   * A negative result is clamped to 0 and logged (see below) rather than returned as-is or thrown.
   */
  private async calculateAccruedInterest(userIds: number[], asset: Asset, dueDate: Date): Promise<number> {
    // Exclude NULL amounts at the query level — mirrors updateCustodyBalance()'s SQL SUM(),
    // which silently skips NULLs; interest and balance must be derived from the same order
    // set, or they drift apart.
    const orders = await this.custodyOrderRepo.find({
      where: [
        {
          user: { id: In(userIds) },
          status: CustodyOrderStatus.COMPLETED,
          inputAsset: { id: asset.id },
          inputAmount: Not(IsNull()),
        },
        {
          user: { id: In(userIds) },
          status: CustodyOrderStatus.COMPLETED,
          outputAsset: { id: asset.id },
          outputAmount: Not(IsNull()),
        },
      ],
    });

    let interest = 0;
    const rate = Config.custody.savingInterestRate;

    for (const order of orders) {
      if (order.inputAsset?.id === asset.id && order.inputAmount != null) {
        interest += this.accrueTranche(order, order.inputAmount, dueDate, rate);
      }
      if (order.outputAsset?.id === asset.id && order.outputAmount != null) {
        interest += this.accrueTranche(order, -order.outputAmount, dueDate, rate);
      }
    }

    // A negative running balance should never occur (updateCustodyBalance() sums Σ input − Σ
    // output over Completed orders), but has been observed in prod — from a deleted or
    // retroactively altered order. Showing a negative interest figure to the customer would be
    // wrong, and throwing would take down their entire balance response for an unrelated data
    // issue elsewhere — so this clamps to 0 and logs the anomaly with enough context (users,
    // asset, computed value) for Ops to find the underlying data problem.
    if (interest < 0) {
      this.logger.warn(
        `Negative accrued interest for user(s) ${userIds.join(', ')}, asset ${asset.uniqueName}: ` +
          `computed ${interest}, clamping to 0 (likely a negative custody balance from a deleted ` +
          `or retroactively altered order)`,
      );
      return 0;
    }

    return interest;
  }

  /**
   * Interest for a single tranche. Fails loud instead of silently skipping or falling back:
   * a Completed order without completedAt is a data error (backfill/transition bug), and a
   * non-finite amount (NaN/Infinity — `float`/`double precision` columns allow both) would
   * otherwise poison the whole sum without a trace.
   */
  private accrueTranche(order: CustodyOrder, amount: number, dueDate: Date, rate: number): number {
    if (!order.completedAt) {
      throw new Error(`CustodyOrder ${order.id} is Completed but has no completedAt — cannot calculate interest`);
    }
    if (!Number.isFinite(amount)) {
      throw new Error(`CustodyOrder ${order.id} has a non-finite amount (${amount}) — cannot calculate interest`);
    }

    const years = Util.yearsDiff(order.completedAt, dueDate);
    return years >= 0 ? amount * rate * years : 0;
  }

  /**
   * Grouping uses UTC (`Util.isoDate`). `asset_price.created` is a local-time
   * `timestamp without time zone`, so multiple snapshots can land on the same UTC day
   * (e.g. local post-midnight). Use the latest price per asset for that day.
   * On equal `created`, the higher `id` wins (later insert), independent of list order.
   */
  private calculateDailyPortfolioValue(dayPrices: AssetPrice[], assetBalancesMap: Map<number, number>): DailyFiatValue {
    const latestPriceByAsset = new Map<number, AssetPrice>();

    for (const price of dayPrices) {
      const existing = latestPriceByAsset.get(price.asset.id);
      if (
        !existing ||
        price.created.getTime() > existing.created.getTime() ||
        (price.created.getTime() === existing.created.getTime() && price.id > existing.id)
      ) {
        latestPriceByAsset.set(price.asset.id, price);
      }
    }

    return [...latestPriceByAsset.values()].reduce(
      (value, price) => {
        const balance = assetBalancesMap.get(price.asset.id) ?? 0;
        value.chf += balance * price.priceChf;
        value.eur += balance * price.priceEur;
        value.usd += balance * price.priceUsd;
        return value;
      },
      { chf: 0, eur: 0, usd: 0 },
    );
  }

  async getUserTotalBalancesChf(date: Date): Promise<Map<number, number>> {
    const balances = await this.getHistoricalBalances(date);
    if (!balances.length) return new Map();

    // Get historical prices
    const assetIds = [...new Set(balances.map((b) => b.assetId))];
    const priceMap = await this.assetPricesService.getAssetPricesForDate(assetIds, date);

    // Sum CHF values per userDataId
    const result = new Map<number, number>();

    for (const { userDataId, assetId, balance } of balances) {
      const priceChf =
        priceMap.get(assetId) ?? (await this.assetService.getAssetById(assetId).then((a) => a?.approxPriceChf));
      if (priceChf && balance > 0) {
        result.set(userDataId, (result.get(userDataId) ?? 0) + balance * priceChf);
      }
    }

    return result;
  }

  private async getHistoricalBalances(date: Date): Promise<{ userDataId: number; assetId: number; balance: number }[]> {
    const deposits = await this.custodyOrderRepo
      .createQueryBuilder('o')
      .select('u.userDataId', 'userDataId')
      .addSelect('o.inputAssetId', 'assetId')
      .addSelect('SUM(o.inputAmount)', 'amount')
      .innerJoin('o.user', 'u')
      .where('o.status = :status', { status: CustodyOrderStatus.COMPLETED })
      .andWhere('o.updated <= :date', { date })
      .groupBy('u.userDataId')
      .addGroupBy('o.inputAssetId')
      .getRawMany<{ userDataId: number; assetId: number; amount: number }>();

    const withdrawals = await this.custodyOrderRepo
      .createQueryBuilder('o')
      .select('u.userDataId', 'userDataId')
      .addSelect('o.outputAssetId', 'assetId')
      .addSelect('SUM(o.outputAmount)', 'amount')
      .innerJoin('o.user', 'u')
      .where('o.status != :status', { status: CustodyOrderStatus.CREATED })
      .andWhere('o.outputAssetId IS NOT NULL')
      .andWhere('o.updated <= :date', { date })
      .groupBy('u.userDataId')
      .addGroupBy('o.outputAssetId')
      .getRawMany<{ userDataId: number; assetId: number; amount: number }>();

    // Calculate net balances
    const balanceMap = new Map<string, { userDataId: number; assetId: number; balance: number }>();

    for (const d of deposits) {
      const key = `${d.userDataId}-${d.assetId}`;
      balanceMap.set(key, { userDataId: d.userDataId, assetId: d.assetId, balance: d.amount });
    }

    for (const w of withdrawals) {
      const key = `${w.userDataId}-${w.assetId}`;
      const existing = balanceMap.get(key);
      if (existing) {
        existing.balance -= w.amount;
      }
    }

    return [...balanceMap.values()];
  }
}
