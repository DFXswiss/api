import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class KycDataTransferDto {
  @ApiProperty({ deprecated: true })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  walletName: string;
}
