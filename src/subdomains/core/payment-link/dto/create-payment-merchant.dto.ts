import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class CreatePaymentMerchantDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  externalId: string;

  @ApiProperty({ description: 'JSON-serialized merchant data' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  data: string;
}
