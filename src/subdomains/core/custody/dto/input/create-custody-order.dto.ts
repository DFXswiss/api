import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CustodyOrderType } from '../../enums/custody';
import { UpdateCustodyOrderInternalDto } from './update-custody-order.dto';

export class CreateCustodyOrderDto {
  @ApiProperty()
  @IsEnum(CustodyOrderType)
  type: CustodyOrderType;

  @ApiPropertyOptional()
  @IsOptional()
  paymentInfo: GetBuyPaymentInfoDto | GetSellPaymentInfoDto | GetSwapPaymentInfoDto;
}

export class CreateCustodyOrderInternalDto extends UpdateCustodyOrderInternalDto {
  user: User;
  type: CustodyOrderType;
  transactionRequestId?: number;
}
