import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { KycStatus, KycType } from '../../user-data/user-data.entity';
import { AmlRule } from '../wallet.entity';

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
  masterKey: string;

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
