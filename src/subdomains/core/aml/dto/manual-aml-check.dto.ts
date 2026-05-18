import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AmlReason } from '../enums/aml-reason.enum';
import { CheckStatus } from '../enums/check-status.enum';

export class ManualAmlCheckDto {
  @IsNotEmpty()
  @IsEnum(CheckStatus)
  amlCheck: CheckStatus;

  @IsOptional()
  @IsEnum(AmlReason)
  amlReason?: AmlReason;

  @IsNotEmpty()
  @IsString()
  responsible: string;
}
