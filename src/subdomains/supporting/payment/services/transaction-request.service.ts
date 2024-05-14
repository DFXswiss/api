import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType, CreateOrder, PaymentType } from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { SwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/swap-payment-info.dto';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { SellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/sell-payment-info.dto';
import { MoreThan } from 'typeorm';
import { CryptoPaymentMethod, FiatPaymentMethod, PaymentMethod } from '../dto/payment-method.enum';
import { TransactionRequest, TransactionRequestType } from '../entities/transaction-request.entity';
import { TransactionRequestRepository } from '../repositories/transaction-request.repository';

@Injectable()
export class TransactionRequestService {
  private readonly logger = new DfxLogger(TransactionRequestService);

  constructor(
    private readonly transactionRequestRepo: TransactionRequestRepository,
    private readonly siftService: SiftService,
  ) {}

  async createTransactionRequest(
    type: TransactionRequestType,
    request: GetBuyPaymentInfoDto | GetSellPaymentInfoDto | GetSwapPaymentInfoDto,
    response: BuyPaymentInfoDto | SellPaymentInfoDto | SwapPaymentInfoDto,
    userId: number,
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
        exactPrice: response.exactPrice,
        dfxFee: response.fees.dfx,
        networkFee: response.fees.network,
        totalFee: response.fees.total,
      });

      let sourceCurrencyName: string;
      let targetCurrencyName: string;
      let blockchain: Blockchain;

      switch (type) {
        case TransactionRequestType.Buy:
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
          break;

        case TransactionRequestType.Sell:
          const sellResponse = response as SellPaymentInfoDto;

          transactionRequest.sourcePaymentMethod = CryptoPaymentMethod.CRYPTO;
          transactionRequest.targetPaymentMethod = FiatPaymentMethod.BANK;
          transactionRequest.sourceId = sellResponse.asset.id;
          transactionRequest.targetId = sellResponse.currency.id;
          sourceCurrencyName = sellResponse.asset.name;
          targetCurrencyName = sellResponse.currency.name;
          blockchain = sellResponse.asset.blockchain;
          break;

        case TransactionRequestType.Swap:
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

      // create order at sift
      await this.siftService.createOrder({
        $order_id: transactionRequest.id.toString(),
        $user_id: userId.toString(),
        $amount: transactionRequest.amount,
        $currency_code: sourceCurrencyName,
        $site_country: 'CH',
        $payment_methods: [{ $payment_type: this.getPaymentType(transactionRequest.sourcePaymentMethod) }],
        $digital_orders: [
          {
            $digital_asset: targetCurrencyName,
            $pair: `${sourceCurrencyName}_${targetCurrencyName}`,
            $asset_type: type == TransactionRequestType.Sell ? AssetType.FIAT : AssetType.CRYPTO,
            $volume: transactionRequest.estimatedAmount.toString(),
          },
        ],
        blockchain,
      } as CreateOrder);
    } catch (e) {
      this.logger.error(
        `Failed to store ${type} transaction request for route ${response.routeId}, request was ${JSON.stringify(
          request,
        )}, response was ${JSON.stringify(response)}:`,
        e,
      );
    }
  }

  getPaymentType(fiatPaymentMethod: PaymentMethod): PaymentType {
    switch (fiatPaymentMethod) {
      case FiatPaymentMethod.BANK:
        return PaymentType.SEPA_CREDIT;
      case FiatPaymentMethod.INSTANT:
        return PaymentType.SEPA_INSTANT_CREDIT;
      case FiatPaymentMethod.CARD:
        return PaymentType.CREDIT_CARD;
      case CryptoPaymentMethod.CRYPTO:
        return PaymentType.CRYPTO_CURRENCY;
      default:
        throw new Error(`No payment type for fiat payment ${fiatPaymentMethod}`);
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
