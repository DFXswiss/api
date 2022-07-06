import { IsInt, IsOptional } from 'class-validator';
import { CryptoSellDto } from './crypto-sell.dto';

export class UpdateCryptoSellDto extends CryptoSellDto {
  @IsOptional()
  @IsInt()
  cryptoInputId: number;
}
