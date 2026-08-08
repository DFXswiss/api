import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export const MAX_SUGGESTION_LENGTH = 4000;

export class CreateSupportReplySuggestionDto {
  @ApiProperty({ description: 'Proposed answer, offered to the clerk as editable text' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(MAX_SUGGESTION_LENGTH)
  @Transform(Util.sanitize)
  text: string;

  @ApiPropertyOptional({
    description:
      'Id of the message this suggestion answers. The suggestion is always bound to the newest message of ' +
      'the thread; passing the id the producer worked from turns a message that arrived in the meantime into ' +
      'a 409 instead of a suggestion bound to a conversation that has moved on.',
  })
  @IsOptional()
  @IsInt()
  messageId?: number;
}
