import { ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { BuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { SwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/swap-payment-info.dto';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { TransactionRequestExtended } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { SellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/sell-payment-info.dto';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { Between, FindOptionsRelations, In, IsNull, LessThan, MoreThan } from 'typeorm';
import { CryptoPaymentMethod, FiatPaymentMethod } from '../dto/payment-method.enum';
import {
  TransactionRequest,
  TransactionRequestStatus,
  TransactionRequestType,
} from '../entities/transaction-request.entity';
import { TransactionRequestRepository } from '../repositories/transaction-request.repository';

@Injectable()
export class TransactionRequestService {
  private readonly logger = new DfxLogger(TransactionRequestService);

  constructor(
    private readonly transactionRequestRepo: TransactionRequestRepository,
    private readonly siftService: SiftService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    @Inject(forwardRef(() => SwapService))
    private readonly swapService: SwapService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async txRequestStatusSync() {
    if (DisabledProcess(Process.TX_REQUEST_STATUS_SYNC)) return;

    const entities = await this.transactionRequestRepo.find({
      where: { status: IsNull() },
      take: 5000,
    });

    const expiryDate = Util.daysBefore(Config.txRequestWaitingExpiryDays);

    for (const entity of entities) {
      await this.transactionRequestRepo.update(entity.id, { status: this.currentStatus(entity, expiryDate) });
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  @Lock(7200)
  async txRequestWaitingExpiryCheck() {
    if (DisabledProcess(Process.TX_REQUEST_WAITING_EXPIRY)) return;

    const expiryDate = Util.daysBefore(Config.txRequestWaitingExpiryDays);
    const entities = await this.transactionRequestRepo.findBy({
      status: TransactionRequestStatus.WAITING_FOR_PAYMENT,
      created: LessThan(expiryDate),
    });

    for (const entity of entities) {
      await this.transactionRequestRepo.update(entity.id, { status: TransactionRequestStatus.CREATED });
    }
  }

  async create(
    type: TransactionRequestType,
    request: GetBuyPaymentInfoDto | GetSellPaymentInfoDto | GetSwapPaymentInfoDto,
    response: BuyPaymentInfoDto | SellPaymentInfoDto | SwapPaymentInfoDto,
    userId: number,
  ): Promise<void> {
    try {
      const uid = `${Config.prefixes.quoteUidPrefix}${Util.randomString(16)}`;

      // create the entity
      const transactionRequest = this.transactionRequestRepo.create({
        type,
        routeId: response.routeId,
        amount: response.amount,
        estimatedAmount: response.estimatedAmount,
        externalTransactionId: request.externalTransactionId,
        exchangeRate: response.exchangeRate,
        rate: response.rate,
        paymentRequest: response.paymentRequest,
        isValid: response.isValid,
        error: response.error,
        exactPrice: response.exactPrice,
        dfxFee: response.fees.dfx,
        networkFee: response.fees.network,
        totalFee: response.fees.total,
        user: { id: userId },
        uid,
      });

      let sourceCurrencyName: string;
      let targetCurrencyName: string;
      let blockchain: Blockchain;
      let siftOrder: boolean;

      switch (type) {
        case TransactionRequestType.BUY:
          const buyRequest = request as GetBuyPaymentInfoDto;
          const buyResponse = response as BuyPaymentInfoDto;

          transactionRequest.sourcePaymentMethod = buyRequest.paymentMethod;
          transactionRequest.targetPaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.sourceId = buyResponse.currency.id;
          transactionRequest.targetId = buyResponse.asset.id;
          transactionRequest.paymentLink = buyResponse.paymentLink;
          sourceCurrencyName = buyResponse.currency.name;
          targetCurrencyName = buyResponse.asset.name;
          blockchain = buyResponse.asset.blockchain;
          siftOrder = true;
          break;

        case TransactionRequestType.SELL:
          const sellResponse = response as SellPaymentInfoDto;

          transactionRequest.sourcePaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.targetPaymentMethod = FiatPaymentMethod.BANK;
          transactionRequest.sourceId = sellResponse.asset.id;
          transactionRequest.targetId = sellResponse.currency.id;
          sourceCurrencyName = sellResponse.asset.name;
          targetCurrencyName = sellResponse.currency.name;
          blockchain = sellResponse.asset.blockchain;
          break;

        case TransactionRequestType.SWAP:
          const convertResponse = response as SwapPaymentInfoDto;

          transactionRequest.sourcePaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.targetPaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.sourceId = convertResponse.sourceAsset.id;
          transactionRequest.targetId = convertResponse.targetAsset.id;
          sourceCurrencyName = convertResponse.sourceAsset.name;
          targetCurrencyName = convertResponse.targetAsset.name;
          break;
      }

      // save
      await this.transactionRequestRepo.save(transactionRequest);
      response.id = transactionRequest.id;
      response.uid = uid;

      // create order at sift (without waiting)
      if (siftOrder)
        void this.siftService.createOrder(
          transactionRequest,
          userId,
          sourceCurrencyName,
          targetCurrencyName,
          blockchain,
        );
    } catch (e) {
      this.logger.error(
        `Failed to store ${type} transaction request for route ${response.routeId}, request was ${JSON.stringify(
          request,
        )}, response was ${JSON.stringify(response)}:`,
        e,
      );
    }
  }

  async getOrThrow(id: number, userId: number): Promise<TransactionRequest | undefined> {
    const request = await this.transactionRequestRepo.findOne({
      where: { id },
      relations: { user: { userData: true }, custodyOrder: true },
    });
    if (!request) throw new NotFoundException('Transaction request not found');
    if (request.user.id !== userId) throw new ForbiddenException('Not your transaction request');

    return request;
  }

  async getTransactionRequest(
    id: number,
    relations: FindOptionsRelations<TransactionRequest> = {},
  ): Promise<TransactionRequest | undefined> {
    return this.transactionRequestRepo.findOne({
      where: { id },
      relations,
    });
  }

  async getWaitingTransactionRequest(
    userDataId: number,
    from = new Date(0),
    to = new Date(),
  ): Promise<TransactionRequest[]> {
    return this.transactionRequestRepo.find({
      where: {
        status: TransactionRequestStatus.WAITING_FOR_PAYMENT,
        user: { userData: { id: userDataId } },
        created: Between(from, to),
      },
      relations: { user: { userData: true } },
    });
  }

  async getTransactionRequestByUid(
    uid: string,
    relations: FindOptionsRelations<TransactionRequest> = {},
  ): Promise<TransactionRequest | undefined> {
    return this.transactionRequestRepo.findOne({ where: { uid }, relations });
  }

  async findAndComplete(
    amount: number,
    routeId: number,
    sourceId: number,
    targetId: number,
  ): Promise<TransactionRequest> {
    const matchingRequests = await this.transactionRequestRepo.find({
      where: {
        routeId,
        sourceId,
        targetId,
        isComplete: false,
        created: MoreThan(Util.daysBefore(Config.txRequestWaitingExpiryDays)),
        status: In([TransactionRequestStatus.CREATED, TransactionRequestStatus.WAITING_FOR_PAYMENT]),
        amount: Between(amount * 0.99, amount * 1.01),
      },
      order: { created: 'DESC' },
      relations: { user: true, custodyOrder: { user: true } },
    });

    const pendingRequests = matchingRequests.filter((t) => t.status === TransactionRequestStatus.WAITING_FOR_PAYMENT);

    const matchingRequest =
      pendingRequests.find((t) => t.amount === amount) ??
      pendingRequests.at(0) ??
      matchingRequests.find((t) => t.amount === amount) ??
      matchingRequests.at(0);

    if (pendingRequests.length > 1) {
      for (const pendingRequest of pendingRequests.filter((t) => t.id !== matchingRequest.id)) {
        await this.transactionRequestRepo.update(...pendingRequest.resetStatus());
      }
    }

    if (matchingRequest) await this.complete(matchingRequest.id);

    return matchingRequest;
  }

  async complete(id: number): Promise<void> {
    await this.transactionRequestRepo.update(id, { isComplete: true, status: TransactionRequestStatus.COMPLETED });
  }

  async extendTransactionRequest(txRequest: TransactionRequest): Promise<TransactionRequestExtended> {
    const sourceAssetEntity =
      txRequest.type === TransactionRequestType.BUY
        ? await this.fiatService.getFiat(txRequest.sourceId)
        : await this.assetService.getAssetById(txRequest.sourceId);

    const targetAssetEntity =
      txRequest.type === TransactionRequestType.SELL
        ? await this.fiatService.getFiat(txRequest.targetId)
        : await this.assetService.getAssetById(txRequest.targetId);

    const transactionRequestExtended = Object.assign(txRequest, { sourceAssetEntity, targetAssetEntity });

    switch (txRequest.type) {
      case TransactionRequestType.BUY:
        return Object.assign(transactionRequestExtended, {
          route: await this.buyService.get(undefined, txRequest.routeId),
        });

      case TransactionRequestType.SELL:
        return Object.assign(transactionRequestExtended, {
          route: await this.sellService.get(undefined, txRequest.routeId),
        });

      case TransactionRequestType.SWAP:
        return Object.assign(transactionRequestExtended, {
          route: await this.swapService.get(undefined, txRequest.routeId),
        });
    }
  }

  async confirmTransactionRequest(txRequest: TransactionRequest): Promise<void> {
    await this.transactionRequestRepo.update(txRequest.id, { status: TransactionRequestStatus.WAITING_FOR_PAYMENT });
  }

  // --- HELPER METHODS --- //

  private currentStatus(entity: TransactionRequest, expiryDate: Date): TransactionRequestStatus {
    if (entity.isComplete || entity.transaction) return TransactionRequestStatus.COMPLETED;
    if (entity.created < expiryDate) return TransactionRequestStatus.CREATED;
    return TransactionRequestStatus.WAITING_FOR_PAYMENT;
  }
}
