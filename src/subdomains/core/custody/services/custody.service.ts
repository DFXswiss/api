import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { AmountType, Util } from 'src/shared/utils/util';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import { In } from 'typeorm';
import { RefService } from '../../referral/process/ref.service';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
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

@Injectable()
export class CustodyService {
  constructor(
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
    private readonly walletService: WalletService,
    private readonly refService: RefService,
    private readonly authService: AuthService,
    private readonly custodyOrderRepo: CustodyOrderRepository,
    private readonly custodyBalanceRepo: CustodyBalanceRepository,
    private readonly assetPricesService: AssetPricesService,
  ) {}

  // --- ACCOUNT --- //
  async createCustodyAccount(accountId: number, dto: CreateCustodyAccountDto, userIp: string): Promise<CustodyAuthDto> {
    const ref = await this.refService.get(userIp);
    if (ref) dto.usedRef ??= ref.ref;

    const wallet =
      (await this.walletService.getByIdOrName(undefined, dto.wallet)) ?? (await this.walletService.getDefault());

    const addressIndex = await this.userService.getNexCustodyIndex();
    const custodyWallet = EvmUtil.createWallet(Config.blockchain.evm.custodyAccount(addressIndex));
    const signature = await custodyWallet.signMessage(Config.auth.signMessageGeneral + custodyWallet.address);

    const account = await this.userDataService.getUserData(accountId);
    if (!account) throw new NotFoundException('User not found');

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
    const balances = CustodyAssetBalanceDtoMapper.mapCustodyBalances(custodyBalances);

    const totalValueInEur = balances.reduce((prev, curr) => prev + curr.valueInEur, 0);
    const totalValueInChf = balances.reduce((prev, curr) => prev + curr.valueInChf, 0);
    const totalValueInUsd = balances.reduce((prev, curr) => prev + curr.valueInUsd, 0);

    return {
      balances,
      totalValueInEur: Util.roundReadable(totalValueInEur, AmountType.FIAT),
      totalValueInChf: Util.roundReadable(totalValueInChf, AmountType.FIAT),
      totalValueInUsd: Util.roundReadable(totalValueInUsd, AmountType.FIAT),
      currency: FiatDtoMapper.toDto(account.currency),
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
      .andWhere('custodyOrder.status != :status', { status: CustodyOrderStatus.CREATED })
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
    });

    if (!custodyOrders.length) return { totalValue: [] };

    const orderMap = custodyOrders.reduce((map, order) => {
      const key = Util.isoDate(order.created);
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
    const startDate = new Date(custodyOrders[0].created);
    startDate.setHours(0, 0, 0, 0);
    const prices = await this.assetPricesService.getAssetPrices(assets, startDate);

    const priceMap = Util.groupByAccessor(prices, (p) => Util.isoDate(p.created));

    // process by day
    const assetBalancesMap = new Map<number, number>();
    const totalValue: CustodyHistoryEntryDto[] = [];

    for (const [day, prices] of priceMap.entries()) {
      const dailyValue = prices.reduce(
        (value, price) => {
          // update asset balance
          const currentBalance = assetBalancesMap.get(price.asset.id) ?? 0;

          const ordersToday = orderMap.get(day)?.get(price.asset.id) ?? [];
          const dayVolume = Util.sum(ordersToday.map((o) => o.amount));

          const newBalance = currentBalance + dayVolume;
          assetBalancesMap.set(price.asset.id, newBalance);

          // update value
          value.chf += newBalance * price.priceChf;
          value.eur += newBalance * price.priceEur;
          value.usd += newBalance * price.priceUsd;

          return value;
        },
        { chf: 0, eur: 0, usd: 0 },
      );

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
}
