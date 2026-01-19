import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SupportIssueInternalState,
  SupportIssueReason,
  SupportIssueState,
  SupportIssueType,
} from '../enums/support-issue.enum';

export enum SupportMessageTranslationKey {
  MONERO_NOT_DISPLAYED = 'support-issue.monero_not_displayed',
}

export class SupportMessageDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  author: string;

  @ApiProperty()
  created: Date;

  @ApiPropertyOptional()
  message?: string;

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
  uid: string;

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

  @ApiProperty({ type: SupportMessageDto, isArray: true })
  messages: SupportMessageDto[];

  @ApiPropertyOptional({ type: SupportIssueTransactionDto })
  transaction?: SupportIssueTransactionDto;

  @ApiPropertyOptional({ type: SupportIssueLimitRequestDto })
  limitRequest?: SupportIssueLimitRequestDto;
}

export const SupportIssueStateMapper: {
  [key in SupportIssueInternalState]: SupportIssueState;
} = {
  [SupportIssueInternalState.CREATED]: SupportIssueState.PENDING,
  [SupportIssueInternalState.PENDING]: SupportIssueState.PENDING,
  [SupportIssueInternalState.COMPLETED]: SupportIssueState.COMPLETED,
  [SupportIssueInternalState.CANCELED]: SupportIssueState.CANCELED,
  [SupportIssueInternalState.ON_HOLD]: SupportIssueState.PENDING,
  [SupportIssueInternalState.BOT_MESSAGE]: SupportIssueState.PENDING,
};
