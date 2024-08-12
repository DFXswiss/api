import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';

export class TransactionRefundDto {
  @ApiProperty()
  @ValidateIf((b: TransactionRefundDto) => Boolean(b.refundUserId || !b.refundAddress))
  @IsInt()
  @ValidateNested()
  @Type(() => EntityDto)
  refundUserId?: number;

  @ApiProperty()
  @ValidateIf((b: TransactionRefundDto) => Boolean(b.refundAddress || !b.refundUserId))
  @IsNotEmpty()
  @IsString()
  refundAddress?: string;
}
