import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { SupportIssueReason, SupportIssueType } from '../entities/support-issue.entity';
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
  transactionRequestUid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  senderIban?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiverIban?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  date?: Date;
}

export class CreateSupportIssueBaseDto extends CreateSupportMessageDto {
  @IsOptional()
  @IsString()
  author: string;

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
