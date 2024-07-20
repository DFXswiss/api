import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { LimitRequest } from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';
import { SupportIssueReason, SupportIssueState, SupportIssueType } from '../entities/support-issue.entity';
import { CreateSupportMessageDto } from './create-support-message.dto';
import { LimitRequestBaseDto } from './limit-request.dto';

export class TransactionIssueDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  id?: number;

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

export class CreateSupportIssueDto extends CreateSupportMessageDto {
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
  transaction: TransactionIssueDto;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => LimitRequestBaseDto)
  @ValidateIf((dto: CreateSupportIssueDto) => dto.type === SupportIssueType.LIMIT_REQUEST)
  limitRequest: LimitRequestBaseDto;
}

export class CreateSupportIssueInternalDto {
  type: SupportIssueType;
  state: SupportIssueState;
  reason: SupportIssueReason;
  name: string;
  fileUrl?: string;
  limitRequest?: LimitRequest;
}
