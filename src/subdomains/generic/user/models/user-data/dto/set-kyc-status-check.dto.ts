import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { KycStatus } from '../user-data.enum';

export class SetKycStatusCheckDto {
  @ApiProperty({ enum: KycStatus })
  @IsEnum(KycStatus)
  expectedKycStatus: KycStatus;
}
