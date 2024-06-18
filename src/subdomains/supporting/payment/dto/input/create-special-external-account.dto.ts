import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { SpecialExternalAccountType } from '../../entities/special-external-account.entity';

export class CreateSpecialExternalAccountDto {
  @IsNotEmpty()
  @IsEnum(SpecialExternalAccountType)
  type: SpecialExternalAccountType;

  @IsNotEmpty()
  @ValidateIf((dto: CreateSpecialExternalAccountDto) =>
    Boolean(dto.type === SpecialExternalAccountType.MULTI_ACCOUNT_IBAN),
  )
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  comment: string;
}
