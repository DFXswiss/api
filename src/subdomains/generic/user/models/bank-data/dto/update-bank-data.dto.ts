import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { UpdateBankAccountDto } from 'src/subdomains/supporting/bank/bank-account/dto/update-bank-account.dto';
import { BankDataType } from '../bank-data.entity';

export class UpdateBankDataDto extends UpdateBankAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @IsOptional()
  @IsEnum(BankDataType)
  type?: BankDataType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  manualApproved?: boolean;
}
