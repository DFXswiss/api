import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CheckStatus } from '../../../core/aml/enums/check-status.enum';

export class UpdateTransactionDto {
  @IsOptional()
  @IsString()
  assets?: string;

  @IsOptional()
  @IsEnum(CheckStatus)
  amlCheck?: CheckStatus;

  @IsOptional()
  @IsBoolean()
  highRisk?: boolean;

  @IsOptional()
  @IsNumber()
  amountInChf?: number;

  @IsOptional()
  @IsString()
  amlType?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  eventDate?: Date;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  userData?: UserData;
}
