import { SupportMessage } from '../entities/support-message.entity';
import { SupportReplySuggestionDto } from './support-reply-suggestion.dto';

export class SupportReplySuggestionDtoMapper {
  /**
   * `latestMessageId` is the newest message of the thread, which decides `isStale`. It is passed in
   * rather than read from the message: the answer is only outdated relative to the thread as it
   * stands now, which the message itself cannot know. Undefined means there is no thread to be
   * newest in, which no caller reaches with a message in hand.
   */
  static mapSuggestion(message: SupportMessage, latestMessageId: number | undefined): SupportReplySuggestionDto {
    const dto: SupportReplySuggestionDto = {
      messageId: message.id,
      text: message.suggestionText,
      state: message.suggestionState,
      isStale: message.id !== latestMessageId,
      created: message.suggestionCreated,
      handled: message.suggestionHandled,
    };

    return Object.assign(new SupportReplySuggestionDto(), dto);
  }
}
