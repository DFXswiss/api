import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { BankDataType } from '../bank-data.entity';

export class UpdateUserBankDataDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ type: EntityDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  preferredCurrency?: Fiat;
}

export class UpdateBankDataDto extends UpdateUserBankDataDto {
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
