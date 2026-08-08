import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CreateSupportReplySuggestionDto } from '../dto/create-support-reply-suggestion.dto';
import { SupportReplySuggestionDtoMapper } from '../dto/support-reply-suggestion-dto.mapper';
import { SupportReplySuggestionDto } from '../dto/support-reply-suggestion.dto';
import { SupportIssue } from '../entities/support-issue.entity';
import { SupportMessage } from '../entities/support-message.entity';
import { SupportReplySuggestion } from '../entities/support-reply-suggestion.entity';
import { SupportReplySuggestionState } from '../enums/support-reply-suggestion.enum';
import { SupportMessageRepository } from '../repositories/support-message.repository';
import { SupportReplySuggestionRepository } from '../repositories/support-reply-suggestion.repository';

@Injectable()
export class SupportReplySuggestionService {
  constructor(
    private readonly suggestionRepo: SupportReplySuggestionRepository,
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
    // Superseding and inserting share one transaction, and the lock is taken on the ISSUE row rather
    // than on the suggestions: two submissions arriving together may each find nothing to supersede,
    // and a lock on rows that do not exist yet cannot order the two inserts. Without it the issue
    // ends up with two suggestions marked Pending, one of them stranded in that state forever.
    const [entity, latestMessageId] = await this.suggestionRepo.manager.transaction(async (manager) => {
      // The issue is read here and nowhere else: a check before the transaction could not speak for
      // the moment of the insert, so it would be a second read of the same row that decides nothing.
      const lockedIssue = await manager
        .createQueryBuilder(SupportIssue, 'issue')
        .where('issue.id = :issueId', { issueId })
        .setLock('pessimistic_write', undefined, ['issue'])
        .getOne();
      if (!lockedIssue) throw new NotFoundException('Support issue not found');

      // The newest message is resolved INSIDE the lock. Read before it, a customer message arriving
      // in between would leave the suggestion bound to a message that is no longer the newest — and
      // `messageId` would have been checked against a thread state that no longer holds, which is
      // exactly the silently-wrong answer the binding exists to prevent.
      const latestMessage = await manager.findOne(SupportMessage, {
        where: { issue: { id: issueId } },
        loadEagerRelations: false,
        order: { id: 'DESC' },
      });
      if (!latestMessage) throw new ConflictException('Support issue has no message to answer');
      if (dto.messageId != null && dto.messageId !== latestMessage.id)
        throw new ConflictException(`Message ${dto.messageId} is not the newest message of the support issue`);

      await this.supersedePending(manager, issueId);

      // `state` is set here as well as on the column: the response is built from the entity in
      // memory, so leaving it to the database default would answer the submission with an empty state.
      const saved = await manager.save(
        manager.create(SupportReplySuggestion, {
          issue: lockedIssue,
          message: latestMessage,
          text: dto.text,
          authorId,
          state: SupportReplySuggestionState.PENDING,
        }),
      );

      return [saved, latestMessage.id] as const;
    });

    return SupportReplySuggestionDtoMapper.mapSuggestion(entity, latestMessageId);
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
    // Read, check and write share one transaction under a pessimistic row lock, the same way the
    // limit request decision does: a decision is taken once, and between "still pending" and the
    // write there must be no window in which a second call can decide it differently. The row would
    // otherwise carry the later decision with no trace that an earlier one ever happened.
    const suggestion = await this.suggestionRepo.manager.transaction(async (manager) => {
      const entity = await manager
        .createQueryBuilder(SupportReplySuggestion, 'suggestion')
        .innerJoinAndSelect('suggestion.message', 'message')
        .innerJoin('suggestion.issue', 'issue')
        .where('suggestion.id = :suggestionId', { suggestionId })
        .andWhere('issue.id = :issueId', { issueId })
        .setLock('pessimistic_write', undefined, ['suggestion'])
        .getOne();

      if (!entity) throw new NotFoundException('Support reply suggestion not found');
      if (!entity.isPending) throw new ConflictException(`Suggestion is already in state ${entity.state}`);

      await manager.update(SupportReplySuggestion, ...entity.setState(state, handledById));

      return entity;
    });

    return SupportReplySuggestionDtoMapper.mapSuggestion(suggestion, await this.getLatestMessageId(issueId));
  }

  private async supersedePending(manager: EntityManager, issueId: number): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(SupportReplySuggestion)
      .set({ state: SupportReplySuggestionState.SUPERSEDED, handled: new Date() })
      .where('"issueId" = :issueId', { issueId })
      .andWhere('state = :state', { state: SupportReplySuggestionState.PENDING })
      .execute();
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
