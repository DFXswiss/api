import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { AmlRule } from 'src/subdomains/core/aml/enums/aml-rule.enum';
import { KycStatus, KycType } from '../../user-data/user-data.entity';

export class WalletDto {
  @IsOptional()
  @IsEnum(AmlRule)
  amlRule: AmlRule;

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
  @IsEnum(KycStatus)
  identMethod?: KycStatus;

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
