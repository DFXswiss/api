import { ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Equal } from 'typeorm';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { SwapService } from '../../buy-crypto/routes/swap/swap.service';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { SellService } from '../../sell-crypto/route/sell.service';
import { OrderConfig } from '../config/order-config';
import { CreateCustodyOrderInternalDto } from '../dto/input/create-custody-order.dto';
import { GetCustodyInfoDto } from '../dto/input/get-custody-info.dto';
import { UpdateCustodyOrderInternalDto } from '../dto/input/update-custody-order.dto';
import { CustodyOrderResponseDto } from '../dto/output/custody-order-response.dto';
import { CustodyOrderDto } from '../dto/output/custody-order.dto';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';
import { CustodyOrder } from '../entities/custody-order.entity';
import { CustodyOrderStepContext, CustodyOrderType } from '../enums/custody';
import { CustodyOrderResponseDtoMapper } from '../mappers/custody-order-response-dto.mapper';
import { GetCustodyOrderDtoMapper } from '../mappers/get-custody-order-dto.mapper';
import { CustodyOrderStepRepository } from '../repositories/custody-order-step.repository';
import { CustodyOrderRepository } from '../repositories/custody-order.repository';
import { CustodyService } from './custody.service';

@Injectable()
export class CustodyOrderService {
  constructor(
    private readonly userService: UserService,
    private readonly custodyOrderRepo: CustodyOrderRepository,
    private readonly custodyOrderStepRepo: CustodyOrderStepRepository,
    private readonly custodyService: CustodyService,
    @Inject(forwardRef(() => SellService))
    private readonly sellService: SellService,
    private readonly buyService: BuyService,
    @Inject(forwardRef(() => SwapService))
    private readonly swapService: SwapService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
  ) {}

  //*** PUBLIC API ***//

  // --- ORDERS --- //
  async createOrder(jwt: JwtPayload, dto: GetCustodyInfoDto): Promise<CustodyOrderDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    if (!user) throw new NotFoundException('User not found');

    const orderDto: CreateCustodyOrderInternalDto = { user, type: dto.type };

    let paymentInfo: CustodyOrderResponseDto = null;

    switch (dto.type) {
      case CustodyOrderType.DEPOSIT:
        const sourceCurrency = await this.fiatService.getFiatByName(dto.sourceAsset);
        if (!sourceCurrency) throw new NotFoundException('Currency not found');

        const targetAsset = await this.assetService.getCustodyAssetByName(dto.targetAsset);
        if (!targetAsset) throw new NotFoundException('Asset not found');

        const buyPaymentInfo = await this.buyService.createBuyPaymentInfo(
          jwt,
          GetCustodyOrderDtoMapper.getBuyPaymentInfo(dto, sourceCurrency, targetAsset),
        );

        orderDto.buy = await this.buyService.getById(buyPaymentInfo.routeId);
        orderDto.inputAsset = await this.assetService.getAssetById(buyPaymentInfo.asset.id);
        paymentInfo = CustodyOrderResponseDtoMapper.mapBuyPaymentInfo(buyPaymentInfo);
        break;

      case CustodyOrderType.WITHDRAWAL:
        const sourceAsset = await this.assetService.getCustodyAssetByName(dto.sourceAsset);
        if (!sourceAsset) throw new NotFoundException('Asset not found');

        const targetCurrency = await this.fiatService.getFiatByName(dto.targetAsset);
        if (!targetCurrency) throw new NotFoundException('Currency not found');

        const sellPaymentInfo = await this.sellService.createSellPaymentInfo(
          jwt.user,
          GetCustodyOrderDtoMapper.getSellPaymentInfo(dto, sourceAsset, targetCurrency),
        );

        orderDto.sell = await this.sellService.getById(sellPaymentInfo.routeId);
        orderDto.outputAsset = await this.assetService.getAssetById(sellPaymentInfo.asset.id);
        orderDto.outputAmount = paymentInfo.amount;
        paymentInfo = CustodyOrderResponseDtoMapper.mapSellPaymentInfo(sellPaymentInfo);
        break;

      case CustodyOrderType.SWAP:
        const source = await this.assetService.getCustodyAssetByName(dto.sourceAsset);
        if (!sourceAsset) throw new NotFoundException('Asset not found');

        const target = await this.assetService.getCustodyAssetByName(dto.targetAsset);
        if (!targetAsset) throw new NotFoundException('Asset not found');

        const swapPaymentInfo = await this.swapService.createSwapPaymentInfo(
          jwt.user,
          GetCustodyOrderDtoMapper.getSwapPaymentInfo(dto, source, target),
        );

        orderDto.swap = await this.swapService.getById(swapPaymentInfo.routeId);
        orderDto.outputAsset = await this.assetService.getAssetById(swapPaymentInfo.sourceAsset.id);
        orderDto.outputAmount = paymentInfo.amount;
        paymentInfo = CustodyOrderResponseDtoMapper.mapSwapPaymentInfo(swapPaymentInfo);
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

    entity = await this.custodyOrderRepo.save(entity);

    await this.custodyService.updateCustodyBalanceForOrder(entity);

    return entity;
  }

  async getCustodyOrderByTx(entity: BuyCrypto | BuyFiat): Promise<CustodyOrder> {
    return this.custodyOrderRepo.findOneBy([
      { transaction: { id: Equal(entity.transaction.id) } },
      { transactionRequest: { id: Equal(entity.transaction.request?.id) } },
    ]);
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

  // --- STEPS --- //
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
      await this.custodyOrderRepo.update(...order.complete());

      await this.custodyService.updateCustodyBalanceForOrder(order);
    }
  }
}
