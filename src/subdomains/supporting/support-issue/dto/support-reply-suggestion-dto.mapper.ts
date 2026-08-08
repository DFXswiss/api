import { SupportReplySuggestion } from '../entities/support-reply-suggestion.entity';
import { SupportReplySuggestionDto } from './support-reply-suggestion.dto';

export class SupportReplySuggestionDtoMapper {
  /**
   * `latestMessageId` is the newest message of the thread, which decides `isStale`. It is passed in
   * rather than read from the suggestion: the answered message is only outdated relative to the
   * thread as it stands now, which the entity cannot know.
   */
  static mapSuggestion(suggestion: SupportReplySuggestion, latestMessageId: number): SupportReplySuggestionDto {
    const dto: SupportReplySuggestionDto = {
      id: suggestion.id,
      text: suggestion.text,
      state: suggestion.state,
      messageId: suggestion.message.id,
      isStale: suggestion.message.id !== latestMessageId,
      created: suggestion.created,
      handled: suggestion.handled,
    };

    return Object.assign(new SupportReplySuggestionDto(), dto);
  }
}
