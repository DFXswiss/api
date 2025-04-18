import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { RefService } from '../../referral/process/ref.service';
import { OrderConfig } from '../config/order-config';

import { Asset } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { CustodyAuthResponseDto } from '../dto/output/create-custody-account-output.dto';
import { CustodyBalance } from '../entities/custody-balance.entity';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';
import { CustodyOrder } from '../entities/custody-order.entity';
import { CustodyOrderStepContext } from '../enums/custody';
import { CustodyBalanceRepository } from '../repositories/custody-balance.repository';
import { CustodyOrderStepRepository } from '../repositories/custody-order-step.repository';
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
    private readonly custodyOrderStepRepo: CustodyOrderStepRepository,
    private readonly custodyBalanceRepo: CustodyBalanceRepository,
  ) {}

  //*** PUBLIC API ***//
  async createCustodyAccount(
    accountId: number,
    dto: CreateCustodyAccountDto,
    userIp: string,
  ): Promise<CustodyAuthResponseDto> {
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

  async createStep(
    order: CustodyOrder,
    index: number,
    command: string,
    context: CustodyOrderStepContext,
  ): Promise<CustodyOrderStep> {
    const orderStep = this.custodyOrderStepRepo.create({
      order,
      index,
      command,
      context,
    });
    return this.custodyOrderStepRepo.save(orderStep);
  }

  async startNextStep(step: CustodyOrderStep): Promise<void> {
    const nextIndex = step.index + 1;
    const order = step.order;
    const nextStep = OrderConfig[order.type][nextIndex];

    if (nextStep) {
      await this.createStep(order, nextIndex, nextStep.command, nextStep.context);
    } else {
      const asset = order.inputAsset ?? order.outputAsset;
      const amount = order.inputAmount ?? -order.outputAmount;

      await this.custodyOrderRepo.update(...order.complete());
      // TODO calculate balance
      const custodyBalance = await this.custodyBalanceRepo.findOneBy({
        asset: { id: asset.id },
        user: { id: order.user.id },
      });

      if (!custodyBalance) {
        await this.createCustodyBalance(amount, order.user, asset);
      } else {
        const { deposit, withdrawal } = await this.custodyOrderRepo
          .createQueryBuilder('custodyOrder')
          .select('SUM(custodyOrder.inputAmount)', 'deposit')
          .addSelect('SUM(custodyOrder.outputAmount)', 'withdrawal')
          .where('userId = :id', { id: order.user.id })
          .andWhere('(custodyOrder.inputAssetId = :asset OR custodyOrder.outputAssetId = :asset)', {
            asset: asset.id,
          })
          .getRawOne<{ deposit: number; withdrawal: number }>();

        await this.updateCustodyBalance(custodyBalance, deposit - withdrawal + amount);
      }
    }
  }

  async createCustodyBalance(balance: number, user: User, asset: Asset): Promise<CustodyBalance> {
    const entity = this.custodyBalanceRepo.create({ user, asset, balance });

    return this.custodyBalanceRepo.save(entity);
  }

  async updateCustodyBalance(entity: CustodyBalance, balance: number): Promise<CustodyBalance> {
    entity.balance = balance;

    return this.custodyBalanceRepo.save(entity);
  }
}
