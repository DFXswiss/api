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
import { AssetPrice } from 'src/subdomains/supporting/pricing/domain/entities/asset-price.entity';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import { In } from 'typeorm';
import { RefService } from '../../referral/process/ref.service';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { CustodyAuthDto } from '../dto/output/custody-auth.dto';
import {
  CustodyBalanceDto,
  CustodyHistoryDto,
  CustodyHistoryEntryDto,
  CustodyValues,
} from '../dto/output/custody-balance.dto';
import { CustodyBalance } from '../entities/custody-balance.entity';
import { CustodyOrderStatus, CustodyOrderType } from '../enums/custody';
import { CustodyAssetBalanceDtoMapper } from '../mappers/custody-asset-balance-dto.mapper';
import { CustodyBalanceRepository } from '../repositories/custody-balance.repository';
import { CustodyOrderRepository } from '../repositories/custody-order.repository';

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

  //*** PUBLIC API ***//
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
    );

    return { accessToken: this.authService.generateUserToken(custodyUser, userIp) };
  }

  async getUserCustodyBalance(accountId: number): Promise<CustodyBalanceDto> {
    const account = await this.userDataService.getUserData(accountId, { users: true });
    if (!account) throw new NotFoundException('User not found');

    const custodyBalances = await this.custodyBalanceRepo.findBy({ user: { id: In(account.users.map((u) => u.id)) } });
    const balances = CustodyAssetBalanceDtoMapper.mapCustodyBalances(custodyBalances, account.currency);
    const totalValue = balances.reduce((prev, curr) => prev + curr.value, 0);

    return {
      balances,
      totalValue: Util.roundReadable(totalValue, AmountType.FIAT),
      currency: FiatDtoMapper.toDto(account.currency),
    };
  }

  async getUserCustodyHistory(accountId: number): Promise<CustodyHistoryDto> {
    const account = await this.userDataService.getUserData(accountId, { users: true });
    if (!account) throw new NotFoundException('User not found');

    const userIds = account.users.map((u) => u.id);

    const custodyOrders = await this.custodyOrderRepo.find({
      where: { user: { id: In(userIds) } },
      order: { created: 'ASC' },
      relations: ['inputAsset', 'outputAsset'],
    });

    if (custodyOrders.length === 0) {
      return { totalValue: [] };
    }

    const custodyBalances = await this.custodyBalanceRepo.find({
      where: { user: { id: In(userIds) } },
      relations: ['asset'],
    });

    const assets = Array.from(new Map(custodyBalances.map((b) => [b.asset.id, b.asset])).values());
    if (assets.length === 0) {
      return { totalValue: [] };
    }

    const assetPricesMap = new Map<number, Map<number, AssetPrice>>();

    for (const asset of assets) {
      const prices = await this.assetPricesService.getAssetPrices(asset, custodyOrders[0].created);
      const priceMap = new Map(prices.map((p) => [p.created.getTime(), p]));
      assetPricesMap.set(asset.id, priceMap);
    }

    const priceDates = Array.from(assetPricesMap.get(assets[0].id)?.values() ?? [])
      .map((p) => p.created)
      .sort((a, b) => a.getTime() - b.getTime());

    const balancesMap = new Map<number, number>();
    const totalValue: CustodyHistoryEntryDto[] = [];

    for (const day of priceDates) {
      const dailyTotal: CustodyValues = { chf: 0, eur: 0, usd: 0 };

      for (const asset of assets) {
        const assetId = asset.id;

        const currentBalance = balancesMap.get(assetId) ?? 0;

        const ordersToday = custodyOrders.filter(
          (o) =>
            Util.sameDay(o.created, day) &&
            ((o.type === CustodyOrderType.DEPOSIT && o.inputAsset.id === assetId) ||
              (o.type !== CustodyOrderType.DEPOSIT && o.outputAsset.id === assetId)),
        );

        const dayVolume = ordersToday.reduce(
          (sum, o) => sum + (o.type === CustodyOrderType.DEPOSIT ? o.inputAmount : -o.outputAmount),
          0,
        );

        const newBalance = currentBalance + dayVolume;
        balancesMap.set(assetId, newBalance);

        const price = assetPricesMap.get(assetId)?.get(day.getTime());
        if (!price) continue;

        dailyTotal.chf += newBalance * price.priceChf;
        dailyTotal.eur += newBalance * price.priceEur;
        dailyTotal.usd += newBalance * price.priceUsd;
      }

      totalValue.push({
        date: day,
        value: dailyTotal,
      });
    }

    return {
      totalValue,
    };
  }

  async createCustodyBalance(balance: number, user: User, asset: Asset): Promise<CustodyBalance> {
    const entity = this.custodyBalanceRepo.create({ user, asset, balance });

    return this.custodyBalanceRepo.save(entity);
  }

  async updateCustodyBalance(amount: number, asset: Asset, user: User) {
    const custodyBalance = await this.custodyBalanceRepo.findOneBy({
      asset: { id: asset.id },
      user: { id: user.id },
    });

    if (!custodyBalance) {
      await this.createCustodyBalance(amount, user, asset);
    } else {
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

      await this.custodyBalanceRepo.update(custodyBalance.id, { balance: deposit - withdrawal });
    }
  }
}
