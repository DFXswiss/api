import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { GetBuyPaymentInfoDto } from '../../buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from '../../buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { GetSellPaymentInfoDto } from '../../sell-crypto/route/dto/get-sell-payment-info.dto';
import { GetCustodyInfoDto } from '../dto/input/get-custody-info.dto';
import { CustodyOrderResponseDto } from '../dto/output/custody-order-response.dto';

export class GetCustodyOrderDtoMapper {
  static getBuyPaymentInfo(paymentInfo: GetCustodyInfoDto, currency: Fiat, asset: Asset): GetBuyPaymentInfoDto {
    const dto: GetBuyPaymentInfoDto = {
      iban: paymentInfo.iban,
      currency,
      asset,
      amount: paymentInfo.amount,
      targetAmount: paymentInfo.targetAmount,
      paymentMethod: FiatPaymentMethod.BANK,
      exactPrice: true,
    };

    return Object.assign(new CustodyOrderResponseDto(), dto);
  }

  static getSellPaymentInfo(paymentInfo: GetCustodyInfoDto, asset: Asset, currency: Fiat): GetSellPaymentInfoDto {
    const dto: GetSellPaymentInfoDto = {
      iban: paymentInfo.iban,
      asset,
      currency,
      amount: paymentInfo.amount,
      targetAmount: paymentInfo.targetAmount,
      exactPrice: true,
    };

    return Object.assign(new CustodyOrderResponseDto(), dto);
  }

  static getSwapPaymentInfo(
    paymentInfo: GetCustodyInfoDto,
    sourceAsset: Asset,
    targetAsset: Asset,
  ): GetSwapPaymentInfoDto {
    const dto: GetSwapPaymentInfoDto = {
      sourceAsset,
      targetAsset,
      amount: paymentInfo.amount,
      targetAmount: paymentInfo.targetAmount,
      exactPrice: true,
    };

    return Object.assign(new CustodyOrderResponseDto(), dto);
  }
}
