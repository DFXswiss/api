import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { CreateSupportReplySuggestionDto } from '../dto/create-support-reply-suggestion.dto';
import { SupportReplySuggestionDtoMapper } from '../dto/support-reply-suggestion-dto.mapper';
import { SupportReplySuggestionDto } from '../dto/support-reply-suggestion.dto';
import { SupportMessage } from '../entities/support-message.entity';
import { SupportReplySuggestionState } from '../enums/support-reply-suggestion.enum';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportMessageRepository } from '../repositories/support-message.repository';
import { SupportReplySuggestionRepository } from '../repositories/support-reply-suggestion.repository';

@Injectable()
export class SupportReplySuggestionService {
  constructor(
    private readonly suggestionRepo: SupportReplySuggestionRepository,
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly messageRepo: SupportMessageRepository,
  ) {}

  /**
   * Submits a proposed answer for an issue. Suggestions come in through the API only — there is no
   * frontend that writes one — and are always bound to the newest message of the thread, so a
   * clerk reading one knows exactly which point of the conversation it answers.
   *
   * A suggestion that is still pending is superseded rather than removed: the clerk is offered the
   * newest one alone, while every earlier proposal stays in the database with the reason it left
   * the pending state.
   */
  async createSuggestion(
    issueId: number,
    dto: CreateSupportReplySuggestionDto,
    authorId: number,
  ): Promise<SupportReplySuggestionDto> {
    const issue = await this.supportIssueRepo.findOne({ where: { id: issueId }, loadEagerRelations: false });
    if (!issue) throw new NotFoundException('Support issue not found');

    const latestMessage = await this.getLatestMessage(issueId);
    if (!latestMessage) throw new ConflictException('Support issue has no message to answer');
    if (dto.messageId != null && dto.messageId !== latestMessage.id)
      throw new ConflictException(`Message ${dto.messageId} is not the newest message of the support issue`);

    await this.supersedePending(issueId);

    // `state` is set here as well as on the column: the response is built from the entity in memory,
    // so leaving it to the database default would answer the submission with an empty state.
    const entity = await this.suggestionRepo.save(
      this.suggestionRepo.create({
        issue,
        message: latestMessage,
        text: dto.text,
        authorId,
        state: SupportReplySuggestionState.PENDING,
      }),
    );

    return SupportReplySuggestionDtoMapper.mapSuggestion(entity, latestMessage.id);
  }

  /** The newest suggestion still awaiting a decision, which is the only one a clerk is offered. */
  async getPendingSuggestion(issueId: number): Promise<SupportReplySuggestionDto | undefined> {
    const suggestion = await this.suggestionRepo.findOne({
      where: { issue: { id: issueId }, state: SupportReplySuggestionState.PENDING },
      relations: { message: true },
      loadEagerRelations: false,
      order: { id: 'DESC' },
    });
    if (!suggestion) return undefined;

    return SupportReplySuggestionDtoMapper.mapSuggestion(suggestion, await this.getLatestMessageId(issueId));
  }

  /** Accepting hands the text to the clerk, who edits and sends it as their own message. */
  async acceptSuggestion(
    issueId: number,
    suggestionId: number,
    handledById: number,
  ): Promise<SupportReplySuggestionDto> {
    return this.handleSuggestion(issueId, suggestionId, SupportReplySuggestionState.ACCEPTED, handledById);
  }

  async rejectSuggestion(
    issueId: number,
    suggestionId: number,
    handledById: number,
  ): Promise<SupportReplySuggestionDto> {
    return this.handleSuggestion(issueId, suggestionId, SupportReplySuggestionState.REJECTED, handledById);
  }

  // --- HELPER METHODS --- //

  private async handleSuggestion(
    issueId: number,
    suggestionId: number,
    state: SupportReplySuggestionState,
    handledById: number,
  ): Promise<SupportReplySuggestionDto> {
    const suggestion = await this.suggestionRepo.findOne({
      where: { id: suggestionId, issue: { id: issueId } },
      relations: { message: true },
      loadEagerRelations: false,
    });
    if (!suggestion) throw new NotFoundException('Support reply suggestion not found');
    // A decision is taken once: re-deciding would overwrite who decided what and when, and that
    // transition is the one thing the row is there to record.
    if (!suggestion.isPending) throw new ConflictException(`Suggestion is already in state ${suggestion.state}`);

    await this.suggestionRepo.update(...suggestion.setState(state, handledById));

    return SupportReplySuggestionDtoMapper.mapSuggestion(suggestion, await this.getLatestMessageId(issueId));
  }

  private async supersedePending(issueId: number): Promise<void> {
    const pending = await this.suggestionRepo.find({
      where: { issue: { id: issueId }, state: SupportReplySuggestionState.PENDING },
      select: { id: true },
      loadEagerRelations: false,
    });
    if (!pending.length) return;

    await this.suggestionRepo.update(
      { id: In(pending.map((s) => s.id)) },
      { state: SupportReplySuggestionState.SUPERSEDED, handled: new Date() },
    );
  }

  private async getLatestMessage(issueId: number): Promise<SupportMessage | null> {
    return this.messageRepo.findOne({
      where: { issue: { id: issueId } },
      loadEagerRelations: false,
      order: { id: 'DESC' },
    });
  }

  /**
   * The newest message of a thread that is known to have one — every suggestion is bound to a
   * message, and messages are never deleted.
   */
  private async getLatestMessageId(issueId: number): Promise<number> {
    return this.getLatestMessage(issueId).then((m) => m.id);
  }
}
