import { IsInt, IsNotEmpty } from 'class-validator';
import { CryptoSellDto } from './crypto-sell.dto';

export class CreateCryptoSellDto extends CryptoSellDto {
  @IsNotEmpty()
  @IsInt()
  cryptoInputId: number;
}
