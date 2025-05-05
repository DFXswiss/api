import { BuyPaymentInfoDto } from '../../buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { SwapPaymentInfoDto } from '../../buy-crypto/routes/swap/dto/swap-payment-info.dto';
import { SellPaymentInfoDto } from '../../sell-crypto/route/dto/sell-payment-info.dto';
import { CustodyOrderResponseDto } from '../dto/output/custody-order-response.dto';

export class CustodyOrderResponseDtoMapper {
  static mapBuyPaymentInfo(paymentInfo: BuyPaymentInfoDto): CustodyOrderResponseDto {
    const dto: CustodyOrderResponseDto = {
      ...this.map(paymentInfo),
      remittanceInfo: paymentInfo.remittanceInfo,
      sourceAsset: paymentInfo.currency.name,
      targetAsset: paymentInfo.asset.name,
      paymentLink: paymentInfo.paymentLink,
      name: paymentInfo.name,
      bank: paymentInfo.bank,
      street: paymentInfo.street,
      number: paymentInfo.number,
      zip: paymentInfo.zip,
      city: paymentInfo.city,
      country: paymentInfo.country,
      iban: paymentInfo.iban,
      bic: paymentInfo.bic,
      sepaInstant: paymentInfo.sepaInstant,
    };

    return Object.assign(new CustodyOrderResponseDto(), dto);
  }

  static mapSellPaymentInfo(paymentInfo: SellPaymentInfoDto): CustodyOrderResponseDto {
    const dto: CustodyOrderResponseDto = {
      ...this.map(paymentInfo),
      sourceAsset: paymentInfo.asset.name,
      targetAsset: paymentInfo.currency.name,
      beneficiary: paymentInfo.beneficiary,
    };

    return Object.assign(new CustodyOrderResponseDto(), dto);
  }

  static mapSwapPaymentInfo(paymentInfo: SwapPaymentInfoDto): CustodyOrderResponseDto {
    const dto: CustodyOrderResponseDto = {
      ...this.map(paymentInfo),
      sourceAsset: paymentInfo.sourceAsset.name,
      targetAsset: paymentInfo.targetAsset.name,
    };

    return Object.assign(new CustodyOrderResponseDto(), dto);
  }

  private static map(
    paymentInfo: BuyPaymentInfoDto | SellPaymentInfoDto | SwapPaymentInfoDto,
  ): CustodyOrderResponseDto {
    const dto: Partial<CustodyOrderResponseDto> = {
      id: paymentInfo.id,
      uid: paymentInfo.uid,
      timestamp: paymentInfo.timestamp,
      minVolume: paymentInfo.minVolume,
      maxVolume: paymentInfo.maxVolume,
      amount: paymentInfo.amount,
      fees: paymentInfo.fees,
      feesTarget: paymentInfo.feesTarget,
      minVolumeTarget: paymentInfo.minVolumeTarget,
      maxVolumeTarget: paymentInfo.maxVolumeTarget,
      exchangeRate: paymentInfo.exchangeRate,
      rate: paymentInfo.rate,
      priceSteps: paymentInfo.priceSteps,
      estimatedAmount: paymentInfo.estimatedAmount,
      paymentRequest: paymentInfo.paymentRequest,
      isValid: paymentInfo.isValid,
      error: paymentInfo.error,
    };

    return Object.assign(new CustodyOrderResponseDto(), dto);
  }
}
