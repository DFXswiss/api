import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { KycStepType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycType } from '../../user-data/user-data.entity';

export class WalletDto {
  @IsOptional()
  @IsString()
  amlRules: string;

  @IsOptional()
  @IsString()
  address: string;

  @IsOptional()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  displayName: string;

  @IsOptional()
  @IsBoolean()
  isKycClient: boolean;

  @IsOptional()
  @IsEnum(KycType)
  customKyc: KycType;

  @IsOptional()
  @IsEnum(KycStepType)
  identMethod?: KycStepType;

  @IsOptional()
  @IsString()
  apiUrl: string;

  @IsOptional()
  @IsString()
  apiKey: string;

  @IsOptional()
  @IsString()
  webhookConfig: string;
}
