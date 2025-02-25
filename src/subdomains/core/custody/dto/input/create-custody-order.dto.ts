import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { CustodyActionType } from '../../enums/custody';

export class CreateCustodyOrderDto {
  @ApiProperty()
  @IsEnum(CustodyActionType)
  type: CustodyActionType;

  @ApiPropertyOptional()
  @IsOptional()
  paymentInfo: GetBuyPaymentInfoDto | GetSellPaymentInfoDto | GetSwapPaymentInfoDto;
}
