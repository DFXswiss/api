import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class TransactionRefundDto {
  @ApiProperty({ description: 'Refund address or refund iban' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trimAll)
  refundTarget: string;
}
