import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { Asset } from 'src/shared/models/asset/asset.entity';
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
import { CustodyBalance } from '../entities/custody-balance.entity';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';
import { CustodyOrder } from '../entities/custody-order.entity';
import { CustodyOrderStepCommand, CustodyOrderStepContext, CustodyOrderType } from '../enums/custody';
import { CustodyOrderResponseDtoMapper } from '../mappers/custody-order-response-dto.mapper';
import { GetCustodyOrderDtoMapper } from '../mappers/get-custody-order-dto.mapper';
import { CustodyOrderStepRepository } from '../repositories/custody-order-step.repository';
import { CustodyOrderRepository } from '../repositories/custody-order.repository';
import { CustodyService } from './custody.service';

@Injectable()
export class CustodyOrderService {
  private readonly CustodyChains = [Blockchain.ETHEREUM];

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

  // --- ORDERS --- //
  async createOrder(jwt: JwtPayload, dto: GetCustodyInfoDto): Promise<CustodyOrderDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true, custodyBalances: true });
    if (!user) throw new NotFoundException('User not found');

    const orderDto: CreateCustodyOrderInternalDto = { user, type: dto.type };

    let paymentInfo: CustodyOrderResponseDto = null;

    switch (dto.type) {
      case CustodyOrderType.DEPOSIT: {
        const sourceCurrency = await this.fiatService.getFiatByName(dto.sourceAsset);
        if (!sourceCurrency) throw new NotFoundException('Source currency not found');

        const targetAsset = await this.getCustodyAsset(dto.targetAsset);
        if (!targetAsset) throw new NotFoundException('Target asset not found');

        const buyPaymentInfo = await this.buyService.createBuyPaymentInfo(
          jwt,
          GetCustodyOrderDtoMapper.getBuyPaymentInfo(dto, sourceCurrency, targetAsset),
        );

        orderDto.buy = await this.buyService.getById(buyPaymentInfo.routeId);
        orderDto.inputAsset = targetAsset;
        paymentInfo = CustodyOrderResponseDtoMapper.mapBuyPaymentInfo(buyPaymentInfo);
        break;
      }
      case CustodyOrderType.WITHDRAWAL: {
        const sourceAsset = await this.getCustodyAsset(dto.sourceAsset);
        if (!sourceAsset) throw new NotFoundException('Source asset not found');

        const targetCurrency = await this.fiatService.getFiatByName(dto.targetAsset);
        if (!targetCurrency) throw new NotFoundException('Target currency not found');

        this.checkBalance(sourceAsset, dto.sourceAmount, user.custodyBalances);

        const sellPaymentInfo = await this.sellService.createSellPaymentInfo(
          jwt.user,
          GetCustodyOrderDtoMapper.getSellPaymentInfo(dto, sourceAsset, targetCurrency),
        );

        orderDto.sell = await this.sellService.getById(sellPaymentInfo.routeId);
        orderDto.outputAsset = sourceAsset;
        orderDto.outputAmount = sellPaymentInfo.amount;
        paymentInfo = CustodyOrderResponseDtoMapper.mapSellPaymentInfo(sellPaymentInfo);
        break;
      }
      case CustodyOrderType.SWAP: {
        const sourceAsset = await this.getCustodyAsset(dto.sourceAsset);
        if (!sourceAsset) throw new NotFoundException('Source asset not found');

        const targetAsset = await this.getCustodyAsset(dto.targetAsset);
        if (!targetAsset) throw new NotFoundException('Target asset not found');

        this.checkBalance(sourceAsset, dto.sourceAmount, user.custodyBalances);

        const swapPaymentInfo = await this.swapService.createSwapPaymentInfo(
          jwt.user,
          GetCustodyOrderDtoMapper.getSwapPaymentInfo(dto, sourceAsset, targetAsset),
        );

        orderDto.swap = await this.swapService.getById(swapPaymentInfo.routeId);
        orderDto.outputAsset = targetAsset;
        orderDto.outputAmount = swapPaymentInfo.amount;
        paymentInfo = CustodyOrderResponseDtoMapper.mapSwapPaymentInfo(swapPaymentInfo);
        break;
      }
      case CustodyOrderType.SEND: {
        const sourceAsset = await this.getCustodyAsset(dto.sourceAsset);
        if (!sourceAsset) throw new NotFoundException('Source asset not found');

        const targetAsset = await this.assetService.getAssetByQuery({
          name: dto.targetAsset,
          blockchain: dto.targetBlockchain,
          type: undefined,
        });
        if (!targetAsset) throw new NotFoundException('Target asset not found');

        this.checkBalance(sourceAsset, dto.sourceAmount, user.custodyBalances);

        const targetUser = await this.userService.getUserByAddress(dto.targetAddress, { userData: true });
        if (!targetUser || targetUser.userData.id !== user.userData.id)
          throw new BadRequestException('Invalid target address');

        const swapPaymentInfo = await this.swapService.createSwapPaymentInfo(
          targetUser.id,
          GetCustodyOrderDtoMapper.getSwapPaymentInfo(dto, sourceAsset, targetAsset),
        );

        orderDto.swap = await this.swapService.getById(swapPaymentInfo.routeId);
        orderDto.outputAsset = targetAsset;
        orderDto.outputAmount = swapPaymentInfo.amount;
        paymentInfo = CustodyOrderResponseDtoMapper.mapSwapPaymentInfo(swapPaymentInfo);
        break;
      }
      case CustodyOrderType.RECEIVE: {
        const sourceAsset = await this.getCustodyAsset(dto.sourceAsset);
        if (!sourceAsset) throw new NotFoundException('Asset not found');

        const targetAsset = await this.getCustodyAsset(dto.targetAsset);
        if (!targetAsset) throw new NotFoundException('Asset not found');

        const swapPaymentInfo = await this.swapService.createSwapPaymentInfo(
          jwt.user,
          GetCustodyOrderDtoMapper.getSwapPaymentInfo(dto, sourceAsset, targetAsset),
        );

        orderDto.swap = await this.swapService.getById(swapPaymentInfo.routeId);
        paymentInfo = CustodyOrderResponseDtoMapper.mapSwapPaymentInfo(swapPaymentInfo);
        break;
      }
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
    return this.custodyOrderRepo.findOne({
      where: [
        { transaction: { id: Equal(entity.transaction.id) } },
        { transactionRequest: { id: Equal(entity.transaction.request?.id) } },
      ],
      relations: { user: true },
    });
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
    command: CustodyOrderStepCommand,
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
    }
  }

  // --- HELPERS --- //
  private async getCustodyAsset(name: string): Promise<Asset | undefined> {
    const assets = await this.assetService.getAssetsByName(name);
    return assets
      .filter((a) => this.CustodyChains.includes(a.blockchain))
      .sort((a, b) => this.CustodyChains.indexOf(a.blockchain) - this.CustodyChains.indexOf(b.blockchain))[0];
  }

  private checkBalance(asset: Asset, amount: number, custodyBalances: CustodyBalance[]): void {
    const assetBalance = custodyBalances.find((a) => a.asset.id === asset.id);
    if (!assetBalance || assetBalance.balance < amount)
      throw new BadRequestException('This transaction can only be created manually by support');
  }
}
