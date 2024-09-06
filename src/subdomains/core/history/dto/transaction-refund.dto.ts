import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class TransactionRefundDto {
  @ApiProperty({ description: 'Refund address or refund iban' })
  @IsNotEmpty()
  @IsString()
  refundTarget: string;
}
