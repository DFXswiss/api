import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { SupportIssueReason } from '../support-issue.entity';

export class CreateTransactionIssueDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(SupportIssueReason)
  reason: SupportIssueReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Base64 encoded file' })
  @IsOptional()
  @IsString()
  file?: string;

  @ApiPropertyOptional({ description: 'Name of the file' })
  @ValidateIf((l: CreateTransactionIssueDto) => l.file != null)
  @IsNotEmpty()
  @IsString()
  fileName?: string;
}
