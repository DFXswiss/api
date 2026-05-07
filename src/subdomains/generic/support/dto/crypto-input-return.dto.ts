import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString, IsPositive } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class CryptoInputReturnDto {
  @ApiProperty({ description: 'Recipient address for the return tx (typically the original sender)' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trimAll)
  @Transform(Util.sanitize)
  destinationAddress: string;

  @ApiProperty({ description: 'Amount to return in asset units (not wei)' })
  @IsNumber()
  @IsPositive()
  chargebackAmount: number;
}
