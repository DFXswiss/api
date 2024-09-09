import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportIssueReason, SupportIssueState, SupportIssueType } from '../entities/support-issue.entity';

export class SupportMessageDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  author: string;

  @ApiProperty()
  created: Date;

  @ApiProperty()
  message: string;

  @ApiPropertyOptional()
  fileUrl?: string;

  @ApiPropertyOptional()
  fileName?: string;
}

export class SupportIssueTransactionDto {
  @ApiProperty()
  uid: string;

  @ApiProperty()
  url: string;
}

export class SupportIssueLimitRequestDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  limit: number;
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

  @ApiPropertyOptional({ type: SupportIssueTransactionDto })
  transaction?: SupportIssueTransactionDto;

  @ApiPropertyOptional({ type: SupportIssueLimitRequestDto })
  limitRequest?: SupportIssueLimitRequestDto;
}
