import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LimitRequest } from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';
import { Transaction } from '../../payment/entities/transaction.entity';
import { SupportIssueReason, SupportIssueState, SupportIssueType } from '../entities/support-issue.entity';

export class FileDto {
  @ApiProperty()
  url: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  type: string;
}

export class SupportMessageDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  author: string;

  @ApiProperty()
  created: Date;

  @ApiProperty()
  message: string;

  @ApiPropertyOptional({ type: FileDto })
  file?: FileDto;
}

export class SupportIssueDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: SupportIssueState })
  state: SupportIssueState;

  @ApiProperty({ enum: SupportIssueType })
  type: SupportIssueType;

  @ApiProperty({ enum: SupportIssueReason })
  reason: SupportIssueReason;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: Date })
  created: Date;

  @ApiProperty({ type: [SupportMessageDto] })
  messages: SupportMessageDto[];

  @ApiPropertyOptional()
  information?: string;

  @ApiPropertyOptional({ type: Transaction })
  transaction?: Transaction;

  @ApiPropertyOptional({ type: LimitRequest })
  limitRequest?: LimitRequest;
}
