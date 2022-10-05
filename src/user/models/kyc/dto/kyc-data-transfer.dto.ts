import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmptyObject, IsString } from 'class-validator';

export class KycDataTransferDto {
  @ApiProperty()
  @IsNotEmptyObject()
  @IsString()
  walletName: string;
}
