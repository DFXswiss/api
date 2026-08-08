import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SpecialExternalAccountType } from '../../entities/special-external-account.entity';

export class CreateSpecialExternalAccountDto {
  @IsNotEmpty()
  @IsEnum(SpecialExternalAccountType)
  type: SpecialExternalAccountType;

  @IsNotEmpty()
  @ValidateIf((dto: CreateSpecialExternalAccountDto) => dto.type === SpecialExternalAccountType.MULTI_ACCOUNT_IBAN)
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  comment: string;

  @IsNotEmpty()
  @ValidateIf(
    (dto: CreateSpecialExternalAccountDto) => dto.type === SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
  )
  @IsEnum(Blockchain)
  blockchain: Blockchain;
}
