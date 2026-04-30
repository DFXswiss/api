import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { PayoutOrderContext } from 'src/subdomains/supporting/payout/entities/payout-order.entity';

export enum PayoutRequestContext {
  BUY_FIAT_RETURN = 'BuyFiatReturn',
  BUY_CRYPTO_RETURN = 'BuyCryptoReturn',
  MANUAL = 'Manual',
}

export class PayoutRequestDto {
  @IsNotEmpty()
  @IsEnum(PayoutRequestContext)
  context: LiquidityOrderContext & PayoutOrderContext;

  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsNotEmpty()
  @IsInt()
  assetId: number;

  @IsNotEmpty()
  @IsString()
  address: string;
}
