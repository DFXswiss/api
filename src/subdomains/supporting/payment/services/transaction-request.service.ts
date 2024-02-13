import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { CryptoPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/crypto-route/dto/crypto-payment-info.dto';
import { SellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/sell-payment-info.dto';
import { TransactionRequestType } from '../entities/transaction-request.entity';
import { TransactionRequestRepository } from '../repositories/transaction-request.repository';

@Injectable()
export class TransactionRequestService {
  private readonly logger = new DfxLogger(TransactionRequestService);

  constructor(private readonly transactionRequestRepo: TransactionRequestRepository) {}

  async createTransactionRequest(
    dto: BuyPaymentInfoDto | SellPaymentInfoDto | CryptoPaymentInfoDto,
    type: TransactionRequestType,
  ): Promise<void> {
    // create the entity
    const transactionRequest = this.transactionRequestRepo.create({
      routeId: dto.routeId,
      fee: dto.fee,
      minFee: dto.minFee,
      minVolume: dto.minVolume,
      maxVolume: dto.maxVolume,
      minFeeTarget: dto.minFeeTarget,
      minVolumeTarget: dto.minVolumeTarget,
      maxVolumeTarget: dto.maxVolumeTarget,
      exchangeRate: dto.exchangeRate,
      amount: dto.amount,
      rate: dto.rate,
      estimatedAmount: dto.estimatedAmount,
      paymentRequest: dto.paymentRequest,
      isValid: dto.isValid,
      error: dto.error,
      type,
    });

    switch (type) {
      case TransactionRequestType.Buy:
        const buyDto = dto as BuyPaymentInfoDto;
        transactionRequest.sourceId = buyDto.currency.id;
        transactionRequest.targetId = buyDto.asset.id;
        break;
      case TransactionRequestType.Sell:
        const sellDto = dto as SellPaymentInfoDto;

        transactionRequest.sourceId = sellDto.asset.id;
        transactionRequest.targetId = sellDto.currency.id;
        break;
      case TransactionRequestType.Convert:
        const cryptoDto = dto as CryptoPaymentInfoDto;
        transactionRequest.sourceId = cryptoDto.sourceAsset.id;
        transactionRequest.targetId = cryptoDto.targetAsset.id;
        break;
    }

    // save
    await this.transactionRequestRepo.save(transactionRequest);
  }
}
