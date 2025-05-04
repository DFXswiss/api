import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
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
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { CreateCustodyOrderDto } from '../dto/input/create-custody-order.dto';
import { CustodyAuthResponseDto } from '../dto/output/create-custody-account-output.dto';
import { CustodyOrderResponseDto } from '../dto/output/create-custody-order-output.dto';
import { CustodyActionType } from '../enums/custody';
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
    private readonly sellService: SellService,
    private readonly buyService: BuyService,
    private readonly swapService: SwapService,
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
      dto.moderator,
    );

    return { accessToken: this.authService.generateUserToken(custodyUser, userIp) };
  }

  async createOrder(jwt: JwtPayload, dto: CreateCustodyOrderDto): Promise<CustodyOrderResponseDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    if (!user) throw new NotFoundException('User not found');

    const action = this.custodyOrderRepo.create({ type: dto.type, user });

    let paymentInfo = null;
    switch (action.type) {
      case CustodyActionType.DEPOSIT:
        paymentInfo = await this.buyService.createBuyPaymentInfo(jwt, dto.paymentInfo as GetBuyPaymentInfoDto);
        break;
      case CustodyActionType.WITHDRAWAL:
        paymentInfo = await this.sellService.createSellPaymentInfo(jwt.user, dto.paymentInfo as GetSellPaymentInfoDto);
        break;
      case CustodyActionType.SWAP:
        paymentInfo = await this.swapService.createSwapPaymentInfo(jwt.user, dto.paymentInfo as GetSwapPaymentInfoDto);
        break;
    }

    action.transactionRequest = { id: paymentInfo.id } as TransactionRequest;
    await this.custodyOrderRepo.save(action);

    return {
      orderId: action.id,
      status: action.status,
      type: action.type,
      paymentInfo: paymentInfo,
    };
  }

  async confirmOrder(userId: number, orderId: number): Promise<void> {
    const order = await this.custodyOrderRepo.findOne({
      where: { id: orderId },
      relations: { user: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (userId != order.user.id) throw new ForbiddenException('Action is not from current user');

    await this.custodyOrderRepo.update(...order.confirm());
  }

  async approveOrder(orderId: number): Promise<void> {
    const order = await this.custodyOrderRepo.findOne({
      where: { id: orderId },
    });

    if (!order) throw new NotFoundException('Order not found');

    await this.custodyOrderRepo.update(...order.approve());
  }
}
