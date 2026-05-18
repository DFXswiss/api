import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { CheckStatus } from '../enums/check-status.enum';

export class ManualAmlCheckDto {
  @IsNotEmpty()
  @IsEnum(CheckStatus)
  amlCheck: CheckStatus;

  @IsNotEmpty()
  @IsString()
  responsible: string;
}
