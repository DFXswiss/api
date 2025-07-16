import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { UpdateBankAccountDto } from 'src/subdomains/supporting/bank/bank-account/dto/update-bank-account.dto';
import { BankDataType } from '../bank-data.entity';

export class UpdateBankDataDto extends UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @IsOptional()
  @IsEnum(BankDataType)
  type?: BankDataType;

  @IsOptional()
  @IsBoolean()
  manualApproved?: boolean;

  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;
}
