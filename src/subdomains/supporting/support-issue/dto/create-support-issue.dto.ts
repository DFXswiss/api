import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { SupportIssueReason, SupportIssueType } from '../entities/support-issue.entity';
import { CreateSupportMessageDto } from './create-support-message.dto';

export class TransactionIssueDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

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
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(SupportIssueType)
  type: SupportIssueType = SupportIssueType.GENERIC_ISSUE;

  @ApiProperty()
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
}
