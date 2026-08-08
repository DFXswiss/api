import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { CreateSupportReplySuggestionDto } from '../dto/create-support-reply-suggestion.dto';
import { SupportReplySuggestionDtoMapper } from '../dto/support-reply-suggestion-dto.mapper';
import { SupportReplySuggestionDto } from '../dto/support-reply-suggestion.dto';
import { SupportMessage } from '../entities/support-message.entity';
import { SupportReplySuggestionState } from '../enums/support-reply-suggestion.enum';
import { SupportMessageRepository } from '../repositories/support-message.repository';

@Injectable()
export class SupportReplySuggestionService {
  constructor(private readonly messageRepo: SupportMessageRepository) {}

  /**
   * Submits a proposed answer for an issue. Suggestions come in through the API only — there is no
   * frontend that writes one — and always answer the newest message of the thread, which is also the
   * message they are stored on.
   *
   * A message carries at most one suggestion: a second submission for the same message is refused
   * rather than replacing what is there. A customer message arriving afterwards does not invalidate
   * the suggestion — it is then simply no longer the newest, which is what `isStale` reports.
   */
  async createSuggestion(
    issueId: number,
    dto: CreateSupportReplySuggestionDto,
    authorId: number,
  ): Promise<SupportReplySuggestionDto> {
    const latestMessage = await this.getLatestMessage(issueId);
    if (!latestMessage) throw new ConflictException('Support issue has no message to answer');
    if (dto.messageId != null && dto.messageId !== latestMessage.id)
      throw new ConflictException(`Message ${dto.messageId} is not the newest message of the support issue`);

    // The condition on the column, rather than a check followed by a write: two submissions arriving
    // together would both find the message empty, and the second would replace the first without a
    // trace. `affected` is what says which one got there first.
    const created = new Date();
    const result = await this.messageRepo.update(
      { id: latestMessage.id, suggestionText: IsNull() },
      {
        suggestionText: dto.text,
        suggestionState: SupportReplySuggestionState.PENDING,
        suggestionAuthorId: authorId,
        suggestionCreated: created,
      },
    );
    if (!result.affected) throw new ConflictException(`Message ${latestMessage.id} already carries a suggestion`);

    latestMessage.setSuggestion(dto.text, authorId, created);

    return SupportReplySuggestionDtoMapper.mapSuggestion(latestMessage, latestMessage.id);
  }

  /** The newest suggestion still awaiting a decision, which is the only one a clerk is offered. */
  async getPendingSuggestion(issueId: number): Promise<SupportReplySuggestionDto | undefined> {
    const message = await this.messageRepo.findOne({
      where: { issue: { id: issueId }, suggestionState: SupportReplySuggestionState.PENDING },
      loadEagerRelations: false,
      order: { id: 'DESC' },
    });
    if (!message) return undefined;

    return SupportReplySuggestionDtoMapper.mapSuggestion(message, await this.getLatestMessageId(issueId));
  }

  /** Accepting hands the text to the clerk, who edits and sends it as their own message. */
  async acceptSuggestion(issueId: number, messageId: number, handledById: number): Promise<SupportReplySuggestionDto> {
    return this.decideSuggestion(issueId, messageId, SupportReplySuggestionState.ACCEPTED, handledById);
  }

  async rejectSuggestion(issueId: number, messageId: number, handledById: number): Promise<SupportReplySuggestionDto> {
    return this.decideSuggestion(issueId, messageId, SupportReplySuggestionState.REJECTED, handledById);
  }

  // --- HELPER METHODS --- //

  private async decideSuggestion(
    issueId: number,
    messageId: number,
    state: SupportReplySuggestionState,
    handledById: number,
  ): Promise<SupportReplySuggestionDto> {
    const message = await this.messageRepo.findOne({
      where: { id: messageId, issue: { id: issueId } },
      loadEagerRelations: false,
    });
    if (!message?.hasSuggestion) throw new NotFoundException('Support reply suggestion not found');

    // A decision is taken once, and the condition on the current state is what makes that true: two
    // calls arriving together would both read `Pending` above, and the second would overwrite who
    // decided what and when — the one thing these columns are there to record.
    const result = await this.messageRepo.update(
      { id: messageId, suggestionState: SupportReplySuggestionState.PENDING },
      { suggestionState: state, suggestionHandledById: handledById, suggestionHandled: new Date() },
    );
    if (!result.affected) throw new ConflictException(`Suggestion is already in state ${message.suggestionState}`);

    message.decideSuggestion(state, handledById);

    return SupportReplySuggestionDtoMapper.mapSuggestion(message, await this.getLatestMessageId(issueId));
  }

  private async getLatestMessage(issueId: number): Promise<SupportMessage | null> {
    return this.messageRepo.findOne({
      where: { issue: { id: issueId } },
      loadEagerRelations: false,
      order: { id: 'DESC' },
    });
  }

  /**
   * The newest message of a thread that is known to have one — a suggestion lives on a message, and
   * messages are never deleted.
   */
  private async getLatestMessageId(issueId: number): Promise<number> {
    return this.getLatestMessage(issueId).then((m) => m.id);
  }
}
