import { IsEnum, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { UserData } from '../../user/models/user-data/user-data.entity';
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
  userData: UserData;
}
