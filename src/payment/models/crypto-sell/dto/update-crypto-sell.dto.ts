import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { CryptoSellDto } from './crypto-sell.dto';

export class UpdateCryptoSellDto extends CryptoSellDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  cryptoInputId: number;
}
