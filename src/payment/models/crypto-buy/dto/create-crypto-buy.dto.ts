import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty } from 'class-validator';
import { CryptoBuyDto } from './crypto-buy.dto';

export class CreateCryptoBuyDto extends CryptoBuyDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  bankTxId: number;
}
