import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { GetBuyPaymentInfoDto } from '../../buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from '../../buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { SwapService } from '../../buy-crypto/routes/swap/swap.service';
import { GetSellPaymentInfoDto } from '../../sell-crypto/route/dto/get-sell-payment-info.dto';
import { SellService } from '../../sell-crypto/route/sell.service';

import { AssetService } from 'src/shared/models/asset/asset.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyPaymentInfoDto } from '../../buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { SwapPaymentInfoDto } from '../../buy-crypto/routes/swap/dto/swap-payment-info.dto';
import { SellPaymentInfoDto } from '../../sell-crypto/route/dto/sell-payment-info.dto';
import { CreateCustodyOrderDto, CreateCustodyOrderInternalDto } from '../dto/input/create-custody-order.dto';
import { UpdateCustodyOrderInternalDto } from '../dto/input/update-custody-order.dto';
import { CustodyOrderDto } from '../dto/output/custody-order.dto';
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
    private readonly assetService: AssetService,
  ) {}

  //*** PUBLIC API ***//

  async createOrder(jwt: JwtPayload, dto: CreateCustodyOrderDto): Promise<CustodyOrderDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    if (!user) throw new NotFoundException('User not found');

    const orderDto: CreateCustodyOrderInternalDto = { user, type: dto.type };

    let paymentInfo: BuyPaymentInfoDto | SellPaymentInfoDto | SwapPaymentInfoDto = null;
    switch (dto.type) {
      case CustodyOrderType.DEPOSIT:
        paymentInfo = await this.buyService.createBuyPaymentInfo(jwt, dto.paymentInfo as GetBuyPaymentInfoDto);
        orderDto.buy = await this.buyService.getById(paymentInfo.routeId);
        orderDto.inputAsset = await this.assetService.getAssetById(paymentInfo.asset.id);
        break;
      case CustodyOrderType.WITHDRAWAL:
        paymentInfo = await this.sellService.createSellPaymentInfo(jwt.user, dto.paymentInfo as GetSellPaymentInfoDto);
        orderDto.sell = await this.sellService.getById(paymentInfo.routeId);
        orderDto.outputAsset = await this.assetService.getAssetById(paymentInfo.asset.id);
        orderDto.outputAmount = paymentInfo.amount;
        break;
      case CustodyOrderType.SWAP:
        paymentInfo = await this.swapService.createSwapPaymentInfo(jwt.user, dto.paymentInfo as GetSwapPaymentInfoDto);
        orderDto.swap = await this.swapService.getById(paymentInfo.routeId);
        orderDto.outputAsset = await this.assetService.getAssetById(paymentInfo.sourceAsset.id);
        orderDto.outputAmount = paymentInfo.amount;
        break;
    }

    const order = await this.createOrderInternal({ ...orderDto, transactionRequestId: paymentInfo.id });

    return {
      orderId: order.id,
      status: order.status,
      type: order.type,
      paymentInfo,
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
}
