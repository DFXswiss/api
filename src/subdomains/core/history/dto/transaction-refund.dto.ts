import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Validate, ValidateIf } from 'class-validator';
import { XOR } from 'src/shared/validators/xor.validator';

export class TransactionRefundDto {
  @ApiProperty({ description: 'Refund address' })
  @ValidateIf((b: TransactionRefundDto) => Boolean(b.refundAddress || !b.refundIban))
  @Validate(XOR, ['refundIban'])
  @IsNotEmpty()
  @IsString()
  refundAddress: string;

  @ApiProperty({ description: 'Refund iban' })
  @ValidateIf((b: TransactionRefundDto) => Boolean(b.refundIban || !b.refundAddress))
  @Validate(XOR, ['refundAddress'])
  @IsNotEmpty()
  @IsString()
  refundIban: string;
}
