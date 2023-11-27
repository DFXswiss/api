import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { RiskEvaluation } from '../../entities/name-check-log.entity';

export class UpdateNameCheckLogDto {
  @IsNotEmpty()
  @IsEnum(RiskEvaluation)
  riskEvaluation: RiskEvaluation;

  @IsNotEmpty()
  @IsString()
  comment: string;
}
