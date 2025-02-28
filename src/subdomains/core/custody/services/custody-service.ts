import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { GetBuyPaymentInfoDto } from '../../buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from '../../buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { SwapService } from '../../buy-crypto/routes/swap/swap.service';
import { RefService } from '../../referral/process/ref.service';
import { GetSellPaymentInfoDto } from '../../sell-crypto/route/dto/get-sell-payment-info.dto';
import { SellService } from '../../sell-crypto/route/sell.service';
import { DfxOrderStepAdapter } from '../adapter/dfx-order-step.adapter';
import { OrderConfig } from '../config/order-config';

import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { CreateCustodyOrderDto } from '../dto/input/create-custody-order.dto';
import { CustodyAuthResponseDto } from '../dto/output/create-custody-account-output.dto';
import { CustodyOrderResponseDto } from '../dto/output/create-custody-order-output.dto';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';
import { CustodyOrder } from '../entities/custody-order.entity';
import {
  CustodyOrderStatus,
  CustodyOrderStepContext,
  CustodyOrderStepStatus,
  CustodyOrderType,
} from '../enums/custody';
import { CustodyOrderStepRepository } from '../repositories/custody-order.-step.repository';
import { CustodyOrderRepository } from '../repositories/custody-order.repository';

@Injectable()
export class CustodyService {
  private readonly logger = new DfxLogger(CustodyService);

  constructor(
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
    private readonly walletService: WalletService,
    private readonly refService: RefService,
    private readonly authService: AuthService,
    private readonly custodyOrderRepo: CustodyOrderRepository,
    private readonly sellService: SellService,
    private readonly buyService: BuyService,
    private readonly swapService: SwapService,
    private readonly custodyOrderStepRepo: CustodyOrderStepRepository,
    private readonly dfxOrderStepAdapter: DfxOrderStepAdapter,
  ) {}

  //*** CRON ***//

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.CUSTODY })
  async executeOrder() {
    const approvedOrders = await this.custodyOrderRepo.find({
      where: { status: CustodyOrderStatus.APPROVED },
    });

    for (const order of approvedOrders) {
      const steps = OrderConfig[order.type];
      if (steps.length) {
        const index = 0;
        await this.createStep(order, index, steps[index].command, steps[index].context);
        await this.custodyOrderRepo.update(...order.progress());
      }
    }
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.CUSTODY })
  async checkOrder() {
    const newSteps = await this.custodyOrderStepRepo.find({
      where: { status: CustodyOrderStepStatus.CREATED },
    });

    for (const step of newSteps) {
      switch (step.context) {
        case CustodyOrderStepContext.DFX:
          await this.custodyOrderStepRepo.update(...step.progress(await this.dfxOrderStepAdapter.execute(step)));
          break;
      }
    }

    const runningSteps = await this.custodyOrderStepRepo.find({
      where: { status: CustodyOrderStepStatus.IN_PROGRESS },
    });

    for (const step of runningSteps) {
      switch (step.context) {
        case CustodyOrderStepContext.DFX:
          if (await this.dfxOrderStepAdapter.isComplete(step)) {
            await this.custodyOrderStepRepo.update(...step.complete());
            await this.startNextStep(step);
          }
          break;
      }
    }
  }

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

  async createOrder(jwt: JwtPayload, dto: CreateCustodyOrderDto): Promise<CustodyOrderResponseDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    if (!user) throw new NotFoundException('User not found');

    const order = this.custodyOrderRepo.create({ type: dto.type, user });

    let paymentInfo = null;
    switch (order.type) {
      case CustodyOrderType.DEPOSIT:
        paymentInfo = await this.buyService.createBuyPaymentInfo(jwt, dto.paymentInfo as GetBuyPaymentInfoDto);
        break;
      case CustodyOrderType.WITHDRAWAL:
        paymentInfo = await this.sellService.createSellPaymentInfo(jwt.user, dto.paymentInfo as GetSellPaymentInfoDto);
        break;
      case CustodyOrderType.SWAP:
        paymentInfo = await this.swapService.createSwapPaymentInfo(jwt.user, dto.paymentInfo as GetSwapPaymentInfoDto);
        break;
    }

    order.transactionRequest = { id: paymentInfo.id } as TransactionRequest;
    await this.custodyOrderRepo.save(order);

    return {
      orderId: order.id,
      status: order.status,
      type: order.type,
      paymentInfo: paymentInfo,
    };
  }

  async confirmOrder(userId: number, orderId: number): Promise<void> {
    const order = await this.custodyOrderRepo.findOne({
      where: { id: orderId },
      relations: { user: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (userId != order.user.id) throw new ForbiddenException('Order is not from current user');

    await this.custodyOrderRepo.update(...order.confirm());
  }

  async approveOrder(orderId: number): Promise<void> {
    const order = await this.custodyOrderRepo.findOne({
      where: { id: orderId },
    });

    if (!order) throw new NotFoundException('Order not found');

    await this.custodyOrderRepo.update(...order.approve());
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
    const nextStep = OrderConfig[step.order.type][nextIndex];
    if (nextStep) {
      await this.createStep(step.order, nextIndex, nextStep.command, nextStep.context);
    } else {
      await this.custodyOrderRepo.update(...step.order.complete());
    }
  }
}
