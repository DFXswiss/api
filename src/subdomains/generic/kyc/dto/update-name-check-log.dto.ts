import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ManualRiskRate } from '../entities/name-check-log.entity';

export class UpdateNameCheckLogDto {
  @IsNotEmpty()
  @IsEnum(ManualRiskRate)
  manualRiskRate: ManualRiskRate;

  @IsNotEmpty()
  @IsString()
  comment: string;
}
