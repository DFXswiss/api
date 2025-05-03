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
import { In } from 'typeorm';
import { RefService } from '../../referral/process/ref.service';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { CustodyAuthDto } from '../dto/output/custody-auth.dto';
import { CustodyBalanceDto } from '../dto/output/custody-balance.dto';
import { CustodyBalance } from '../entities/custody-balance.entity';
import { CustodyOrderStatus } from '../enums/custody';
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
