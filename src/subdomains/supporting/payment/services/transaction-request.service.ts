import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { CryptoPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/crypto-route/dto/crypto-payment-info.dto';
import { GetCryptoPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/crypto-route/dto/get-crypto-payment-info.dto';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { SellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/sell-payment-info.dto';
import { MoreThan } from 'typeorm';
import { CryptoPaymentMethod, FiatPaymentMethod } from '../dto/payment-method.enum';
import { TransactionRequest, TransactionRequestType } from '../entities/transaction-request.entity';
import { TransactionRequestRepository } from '../repositories/transaction-request.repository';

@Injectable()
export class TransactionRequestService {
  private readonly logger = new DfxLogger(TransactionRequestService);

  constructor(private readonly transactionRequestRepo: TransactionRequestRepository) {}

  async createTransactionRequest(
    type: TransactionRequestType,
    request: GetBuyPaymentInfoDto | GetSellPaymentInfoDto | GetCryptoPaymentInfoDto,
    response: BuyPaymentInfoDto | SellPaymentInfoDto | CryptoPaymentInfoDto,
  ): Promise<void> {
    try {
      // create the entity
      const transactionRequest = this.transactionRequestRepo.create({
        type: type,
        routeId: response.routeId,
        amount: response.amount,
        estimatedAmount: response.estimatedAmount,
        externalTransactionId: request.externalTransactionId,
        exchangeRate: response.exchangeRate,
        rate: response.rate,
        paymentRequest: response.paymentRequest,
        isValid: response.isValid,
        error: response.error,
        fee: response.fee,
        exactPrice: response.exactPrice,
        minFee: response.minFee,
      });

      switch (type) {
        case TransactionRequestType.Buy:
          const buyRequest = request as GetBuyPaymentInfoDto;
          const buyResponse = response as BuyPaymentInfoDto;

          transactionRequest.sourcePaymentMethod = buyRequest.paymentMethod;
          transactionRequest.targetPaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.sourceId = buyResponse.currency.id;
          transactionRequest.targetId = buyResponse.asset.id;
          transactionRequest.paymentLink = buyResponse.paymentLink;
          break;

        case TransactionRequestType.Sell:
          const sellResponse = response as SellPaymentInfoDto;

          transactionRequest.sourcePaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.targetPaymentMethod = FiatPaymentMethod.BANK;
          transactionRequest.sourceId = sellResponse.asset.id;
          transactionRequest.targetId = sellResponse.currency.id;
          break;

        case TransactionRequestType.Convert:
          const convertResponse = response as CryptoPaymentInfoDto;

          transactionRequest.sourcePaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.targetPaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.sourceId = convertResponse.sourceAsset.id;
          transactionRequest.targetId = convertResponse.targetAsset.id;
          break;
      }

      // save
      await this.transactionRequestRepo.save(transactionRequest);
    } catch (e) {
      this.logger.error(`Failed to store ${type} transaction request for route ${response.routeId}:`, e);
    }
  }

  async findAndCompleteRequest(
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

    if (transactionRequest) await this.transactionRequestRepo.update(transactionRequest.id, { isComplete: true });
    return transactionRequest;
  }
}
