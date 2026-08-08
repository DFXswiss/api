import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportReplySuggestionState } from '../enums/support-reply-suggestion.enum';

export class SupportReplySuggestionDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: 'Proposed answer, offered to the clerk as editable text' })
  text: string;

  @ApiProperty({ enum: SupportReplySuggestionState })
  state: SupportReplySuggestionState;

  @ApiProperty({ description: 'Id of the message this suggestion answers' })
  messageId: number;

  @ApiProperty({
    description:
      'Whether the answered message is no longer the newest one of the thread — the conversation has moved ' +
      'on since the suggestion was written',
  })
  isStale: boolean;

  @ApiProperty({ type: Date })
  created: Date;

  @ApiPropertyOptional({ type: Date, description: 'When the suggestion was accepted or rejected' })
  handled?: Date;
}

export class SupportReplySuggestionResponseDto {
  @ApiPropertyOptional({
    type: SupportReplySuggestionDto,
    description: 'The newest suggestion still awaiting a decision, or null when there is none',
  })
  suggestion: SupportReplySuggestionDto | null;
}
