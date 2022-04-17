import { IsInt, IsOptional } from 'class-validator';
import { BuyCryptoDto } from './buy-crypto.dto';

export class UpdateBuyCryptoDto extends BuyCryptoDto {
  @IsOptional()
  @IsInt()
  bankTxId: number;

  @IsOptional()
  @IsInt()
  cryptoInputId: number;
}
