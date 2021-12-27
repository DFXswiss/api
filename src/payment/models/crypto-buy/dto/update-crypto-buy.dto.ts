import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { CryptoBuyDto } from './crypto-buy.dto';

export class UpdateCryptoBuyDto extends CryptoBuyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  bankTxId: number;
}
