import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SpecialExternalAccountType } from '../../entities/special-external-account.entity';

export class CreateSpecialExternalAccountDto {
  @IsNotEmpty()
  @IsEnum(SpecialExternalAccountType)
  type: SpecialExternalAccountType;

  @IsOptional()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  comment: string;
}
