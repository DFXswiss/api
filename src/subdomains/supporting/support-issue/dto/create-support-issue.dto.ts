import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { Department } from '../enums/department.enum';
import { SupportIssueReason, SupportIssueType } from '../enums/support-issue.enum';
import { CreateSupportMessageDto } from './create-support-message.dto';
import { LimitRequestDto } from './limit-request.dto';

export class TransactionIssueDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  uid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderUid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  senderIban?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  receiverIban?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  date?: Date;
}

export class CreateSupportIssueBaseDto extends CreateSupportMessageDto {
  @IsOptional()
  @IsEnum(Department)
  department?: Department;

  @ApiProperty({ enum: SupportIssueType })
  @IsNotEmpty()
  @IsEnum(SupportIssueType)
  type: SupportIssueType = SupportIssueType.GENERIC_ISSUE;

  @ApiProperty({ enum: SupportIssueReason })
  @IsNotEmpty()
  @IsEnum(SupportIssueReason)
  reason: SupportIssueReason;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  name: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => TransactionIssueDto)
  @ValidateIf((dto: CreateSupportIssueDto) => dto.type === SupportIssueType.TRANSACTION_ISSUE)
  transaction?: TransactionIssueDto;
}

export class CreateSupportIssueDto extends CreateSupportIssueBaseDto {
  @ApiPropertyOptional()
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => LimitRequestDto)
  @ValidateIf((dto: CreateSupportIssueDto) => dto.type === SupportIssueType.LIMIT_REQUEST)
  limitRequest?: LimitRequestDto;
}

export class CreateSupportIssueSupportDto extends CreateSupportIssueBaseDto {}
