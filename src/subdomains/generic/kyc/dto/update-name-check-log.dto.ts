import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ManualRiskRate } from '../entities/kyc-log.entity';

export class UpdateNameCheckLogDto {
  @IsNotEmpty()
  @IsEnum(ManualRiskRate)
  manualRiskRate: ManualRiskRate;

  @IsNotEmpty()
  @IsString()
  comment: string;
}
