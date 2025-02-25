import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { GetBuyPaymentInfoDto } from '../../buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from '../../buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { SwapService } from '../../buy-crypto/routes/swap/swap.service';
import { RefService } from '../../referral/process/ref.service';
import { GetSellPaymentInfoDto } from '../../sell-crypto/route/dto/get-sell-payment-info.dto';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { CreateCustodyActionOrderDto } from '../dto/input/create-custody-action-order.dto';
import { CustodyAuthResponseDto } from '../dto/output/create-custody-account-output.dto';
import { CustodyActionOrderResponseDto } from '../dto/output/create-custody-action-order-output.dto';
import { CustodyActionType } from '../enums/custody';
import { CustodyActionOrderRepository } from '../repositories/custody-action-order.repository';

@Injectable()
export class CustodyService {
  private readonly logger = new DfxLogger(CustodyService);

  constructor(
    private readonly userService: UserService,
    private readonly walletService: WalletService,
    private readonly refService: RefService,
    private readonly siftService: SiftService,
    private readonly authService: AuthService,
    private readonly custodyActionOrderRepo: CustodyActionOrderRepository,
    private readonly sellService: SellService,
    private readonly buyService: BuyService,
    private readonly swapService: SwapService,
  ) {}
  //*** PUBLIC API ***//

  async createCustodyAccount(
    userId: number,
    dto: CreateCustodyAccountDto,
    userIp: string,
  ): Promise<CustodyAuthResponseDto> {
    const ref = await this.refService.get(userIp);
    if (ref) dto.usedRef ??= ref.ref;

    const wallet = await this.walletService.getByIdOrName(undefined, 'CustodyDFX');
    const addressIndex = await this.userService.getNexCustodyIndex();
    const custodyWallet = EvmUtil.createWallet(Config.blockchain.evm.custodyAccount(addressIndex));
    const signature = await custodyWallet.signMessage(Config.auth.signMessageGeneral + custodyWallet.address);

    const user = await this.userService.getUser(userId, { userData: true });
    if (!user) throw new NotFoundException('User not exist');

    const custodyUser = await this.userService.createUser(
      {
        address: custodyWallet.address,
        signature,
        usedRef: dto.usedRef,
        ip: userIp,
        origin: ref?.origin,
        wallet,
        userData: user.userData,
        custodyAddressType: dto.addressType,
        custodyAddressIndex: addressIndex,
        role: UserRole.CUSTODY,
      },
      dto.specialCode,
    );

    await this.siftService.createAccount(custodyUser);
    return { accessToken: this.authService.generateUserToken(custodyUser, userIp) };
  }

  async createActionOrder(jwt: JwtPayload, dto: CreateCustodyActionOrderDto): Promise<CustodyActionOrderResponseDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    if (!user) throw new NotFoundException('User not exist');

    const action = this.custodyActionOrderRepo.create({ type: dto.type, user });

    await this.custodyActionOrderRepo.save(action);

    switch (action.type) {
      case CustodyActionType.DEPOSIT:
        const buy = await this.buyService.createBuyPayment(jwt, dto.paymentInfo as GetBuyPaymentInfoDto);
        return {
          actionOrderId: action.id,
          status: action.status,
          type: action.type,
          paymentInfo: await this.buyService.toPaymentInfoDto(jwt.user, buy, dto.paymentInfo as GetBuyPaymentInfoDto),
        };
      case CustodyActionType.WITHDRAWAL:
        const sell = await this.sellService.createSellPayment(jwt.user, dto.paymentInfo as GetSellPaymentInfoDto);
        return {
          actionOrderId: action.id,
          status: action.status,
          type: action.type,
          paymentInfo: await this.sellService.toPaymentInfoDto(
            jwt.user,
            sell,
            dto.paymentInfo as GetSellPaymentInfoDto,
          ),
        };
      case CustodyActionType.SWAP:
        const swap = await this.swapService.createSwapPayment(jwt.user, dto.paymentInfo as GetSwapPaymentInfoDto);
        return {
          actionOrderId: action.id,
          status: action.status,
          type: action.type,
          paymentInfo: await this.swapService.toPaymentInfoDto(
            jwt.user,
            swap,
            dto.paymentInfo as GetSwapPaymentInfoDto,
          ),
        };
    }
  }

  async confirmActionOrder(userId: number, actionOrderId: number): Promise<void> {
    const user = await this.userService.getUser(userId, { userData: true });

    const actionOrder = await this.custodyActionOrderRepo.findOne({
      where: { id: actionOrderId },
      relations: ['user'],
    });

    if (!user && user.id != actionOrder.user.id) throw new ForbiddenException('Action is not from current user');

    actionOrder.confirm();
    await this.custodyActionOrderRepo.save(actionOrder);
  }

  async approveActionOrder(actionOrderId: number): Promise<void> {
    const actionOrder = await this.custodyActionOrderRepo.findOne({
      where: { id: actionOrderId },
      relations: ['user'],
    });

    actionOrder.approve();
    await this.custodyActionOrderRepo.save(actionOrder);
  }
}
