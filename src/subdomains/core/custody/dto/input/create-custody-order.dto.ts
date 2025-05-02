import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetSwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
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

export interface CreateCustodyOrderInternalDto extends UpdateCustodyOrderInternalDto {
  user: User;
  type: CustodyOrderType;
  sell?: Sell;
  swap?: Swap;
  buy?: Buy;
  inputAsset?: Asset;
  inputAmount?: number;
  outputAsset?: Asset;
  outputAmount?: number;
  transactionRequestId?: number;
}
