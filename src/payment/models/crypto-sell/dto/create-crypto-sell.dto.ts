import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty } from 'class-validator';
import { CryptoSellDto } from './crypto-sell.dto';

export class CreateCryptoSellDto extends CryptoSellDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  cryptoInputId: number;
}
