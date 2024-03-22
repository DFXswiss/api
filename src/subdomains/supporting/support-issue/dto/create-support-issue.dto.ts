import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Transaction } from '../../payment/entities/transaction.entity';
import { SupportIssueReason } from '../support-issue.entity';

export class CreateSupportIssueDto {
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

  @ApiPropertyOptional({ description: 'Name of the proof document' })
  @ValidateIf((l: CreateSupportIssueDto) => l.file != null)
  @IsNotEmpty()
  @IsString()
  fileName?: string;

  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  transaction: Transaction;
}
