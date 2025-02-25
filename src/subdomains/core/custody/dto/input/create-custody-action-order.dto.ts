import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { CustodyActionType } from '../../enums/custody';

export class CreateCustodyActionOrderDto {
  @ApiProperty()
  @IsEnum(CustodyActionType)
  type: CustodyActionType;

  @ApiProperty()
  @IsEnum(GetBuyPaymentInfoDto)
  paymentInfo: GetBuyPaymentInfoDto | GetSellPaymentInfoDto | GetSwapPaymentInfoDto;
}
