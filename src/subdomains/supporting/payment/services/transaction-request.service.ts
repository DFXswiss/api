import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { SwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/swap-payment-info.dto';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { SellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/sell-payment-info.dto';
import { FindOptionsRelations, IsNull, MoreThan } from 'typeorm';
import { CryptoPaymentMethod, FiatPaymentMethod } from '../dto/payment-method.enum';
import { TransactionRequest, TransactionRequestType } from '../entities/transaction-request.entity';
import { TransactionRequestRepository } from '../repositories/transaction-request.repository';

export const QUOTE_UID_PREFIX = 'Q';

@Injectable()
export class TransactionRequestService {
  private readonly logger = new DfxLogger(TransactionRequestService);

  constructor(
    private readonly transactionRequestRepo: TransactionRequestRepository,
    private readonly siftService: SiftService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async uidSync() {
    if (DisabledProcess(Process.TX_REQUEST_UID_SYNC)) return;

    const entities = await this.transactionRequestRepo.find({ where: { uid: IsNull() }, take: 5000 });

    for (const entity of entities) {
      try {
        const hash = Util.createHash(entity.type + new Date() + Util.randomId()).toUpperCase();

        await this.transactionRequestRepo.update(entity.id, { uid: `${QUOTE_UID_PREFIX}${hash.slice(0, 16)}` });
      } catch (e) {
        this.logger.error(`Error in TransactionRequest sync ${entity.id}`, e);
      }
    }
  }

  async create(
    type: TransactionRequestType,
    request: GetBuyPaymentInfoDto | GetSellPaymentInfoDto | GetSwapPaymentInfoDto,
    response: BuyPaymentInfoDto | SellPaymentInfoDto | SwapPaymentInfoDto,
    userId: number,
  ): Promise<void> {
    try {
      const hash = Util.createHash(type + new Date() + Util.randomId()).toUpperCase();
      const uid = `${QUOTE_UID_PREFIX}${hash.slice(0, 16)}`;

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
      relations: { user: { userData: true } },
    });
    if (!request) throw new NotFoundException('Transaction request not found');
    if (request.user.id !== userId) throw new ForbiddenException('Not your transaction request');

    return request;
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
    const transactionRequests = await this.transactionRequestRepo.find({
      where: {
        routeId,
        sourceId,
        targetId,
        isComplete: false,
        created: MoreThan(Util.daysBefore(2)),
      },
      order: { created: 'DESC' },
    });

    const transactionRequest = transactionRequests.find((t) => Math.abs(amount - t.amount) / t.amount < 0.01);

    if (transactionRequest) await this.complete(transactionRequest.id);
    return transactionRequest;
  }

  async complete(id: number): Promise<void> {
    await this.transactionRequestRepo.update(id, { isComplete: true });
  }

  // --- HELPER METHODS --- //
}
