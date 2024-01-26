import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class KycDataTransferDto {
  @ApiProperty({ deprecated: true })
  @IsNotEmpty()
  @IsString()
  walletName: string;
}
