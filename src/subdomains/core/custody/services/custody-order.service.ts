import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { GetBuyPaymentInfoDto } from '../../buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from '../../buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { SwapService } from '../../buy-crypto/routes/swap/swap.service';
import { GetSellPaymentInfoDto } from '../../sell-crypto/route/dto/get-sell-payment-info.dto';
import { SellService } from '../../sell-crypto/route/sell.service';

import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { CreateCustodyOrderDto, CreateCustodyOrderInternalDto } from '../dto/input/create-custody-order.dto';
import { UpdateCustodyOrderInternalDto } from '../dto/input/update-custody-order.dto';
import { CustodyOrderResponseDto } from '../dto/output/create-custody-order-output.dto';
import { CustodyOrder } from '../entities/custody-order.entity';
import { CustodyOrderType } from '../enums/custody';
import { CustodyOrderRepository } from '../repositories/custody-order.repository';

@Injectable()
export class CustodyOrderService {
  constructor(
    private readonly userService: UserService,
    private readonly custodyOrderRepo: CustodyOrderRepository,
    private readonly sellService: SellService,
    private readonly buyService: BuyService,
    private readonly swapService: SwapService,
  ) {}

  //*** PUBLIC API ***//

  async createOrder(jwt: JwtPayload, dto: CreateCustodyOrderDto): Promise<CustodyOrderResponseDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    if (!user) throw new NotFoundException('User not found');

    let paymentInfo = null;
    switch (dto.type) {
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

    const order = await this.createOrderInternal({ user, type: dto.type, transactionRequestId: paymentInfo.id });

    return {
      orderId: order.id,
      status: order.status,
      type: order.type,
      paymentInfo: paymentInfo,
    };
  }

  async createOrderInternal(dto: CreateCustodyOrderInternalDto): Promise<CustodyOrder> {
    const order = this.custodyOrderRepo.create(dto);

    if (dto.transactionRequestId) order.transactionRequest = { id: dto.transactionRequestId } as TransactionRequest;

    return this.custodyOrderRepo.save(order);
  }

  async updateCustodyOrderInternal(entity: CustodyOrder, dto: UpdateCustodyOrderInternalDto): Promise<CustodyOrder> {
    Object.assign(entity, dto);

    return this.custodyOrderRepo.save(entity);
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

  async getCustodyOrder(transactionRequest: TransactionRequest): Promise<CustodyOrder> {
    return;
  }
}
