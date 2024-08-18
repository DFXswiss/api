import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class TransactionRefundDto {
  @ApiPropertyOptional()
  @ValidateIf((b: TransactionRefundDto) => Boolean(b.refundUserId || !b.refundAddress))
  @IsNotEmpty()
  @IsInt()
  refundUserId?: number;

  @ApiPropertyOptional()
  @ValidateIf((b: TransactionRefundDto) => Boolean(b.refundAddress || !b.refundUserId))
  @IsNotEmpty()
  @IsString()
  refundAddress?: string;
}
