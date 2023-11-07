import { IsEnum, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { RiskRate } from '../entities/kyc-log.entity';

export class CreateKycLogDto {
  @IsNotEmpty()
  @IsString()
  eventType: string;

  @IsNotEmpty()
  @IsString()
  result: string;

  @IsNotEmpty()
  @IsString()
  pdfUrl: string;

  @IsNotEmpty()
  @IsEnum(RiskRate)
  riskRate: RiskRate;

  @IsNotEmpty()
  @IsNumber()
  userDataId: number;
}
