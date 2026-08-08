import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportMessage } from 'src/subdomains/supporting/support-issue/entities/support-message.entity';
import { SupportReplySuggestion } from 'src/subdomains/supporting/support-issue/entities/support-reply-suggestion.entity';
import { SupportReplySuggestionState } from 'src/subdomains/supporting/support-issue/enums/support-reply-suggestion.enum';
import { SupportIssueRepository } from 'src/subdomains/supporting/support-issue/repositories/support-issue.repository';
import { SupportMessageRepository } from 'src/subdomains/supporting/support-issue/repositories/support-message.repository';
import { SupportReplySuggestionRepository } from 'src/subdomains/supporting/support-issue/repositories/support-reply-suggestion.repository';
import { SupportReplySuggestionService } from 'src/subdomains/supporting/support-issue/services/support-reply-suggestion.service';
import { EntityManager } from 'typeorm';

const ISSUE_ID = 42;
const AUTHOR_ID = 7;
const CLERK_ID = 9;

const issue = (): SupportIssue => Object.assign(new SupportIssue(), { id: ISSUE_ID });
const message = (id: number): SupportMessage => Object.assign(new SupportMessage(), { id });
const suggestion = (values: Partial<SupportReplySuggestion>): SupportReplySuggestion =>
  Object.assign(new SupportReplySuggestion(), {
    id: 1,
    text: 'Please check again',
    state: SupportReplySuggestionState.PENDING,
    authorId: AUTHOR_ID,
    created: new Date('2026-08-08T10:00:00Z'),
    ...values,
  });

describe('SupportReplySuggestionService', () => {
  let service: SupportReplySuggestionService;
  let suggestionRepo: DeepMocked<SupportReplySuggestionRepository>;
  let supportIssueRepo: DeepMocked<SupportIssueRepository>;
  let messageRepo: DeepMocked<SupportMessageRepository>;

  // The service reaches the transactional connection through `suggestionRepo.manager`; the callback
  // runs against this manager, the same technique limit-request.service.spec.ts uses.
  let queryBuilder: {
    innerJoinAndSelect: jest.Mock;
    innerJoin: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    setLock: jest.Mock;
    getOne: jest.Mock;
    update: jest.Mock;
    set: jest.Mock;
    execute: jest.Mock;
  };
  let mockManager: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };

  /** What the supersede statement was built from. */
  const supersedeUpdate = (): Record<string, unknown> => queryBuilder.set.mock.calls[0][0];

  beforeEach(() => {
    suggestionRepo = createMock<SupportReplySuggestionRepository>();
    supportIssueRepo = createMock<SupportIssueRepository>();
    messageRepo = createMock<SupportMessageRepository>();

    queryBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(issue()),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    mockManager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      // the newest message is resolved inside the transaction, under the issue lock
      findOne: jest.fn().mockResolvedValue(message(100)),
      create: jest.fn((_entity, values) => Object.assign(new SupportReplySuggestion(), values)),
      save: jest.fn(async (entity) => Object.assign(entity, { id: 5, created: new Date('2026-08-08T12:00:00Z') })),
      update: jest.fn(),
    };
    Object.defineProperty(suggestionRepo, 'manager', {
      value: {
        transaction: jest.fn(async (run: (manager: EntityManager) => Promise<unknown>) =>
          run(mockManager as unknown as EntityManager),
        ),
      },
    });

    supportIssueRepo.findOne.mockResolvedValue(issue());
    messageRepo.findOne.mockResolvedValue(message(100));

    service = new SupportReplySuggestionService(suggestionRepo, supportIssueRepo, messageRepo);
  });

  describe('createSuggestion', () => {
    it('binds the suggestion to the newest message of the thread', async () => {
      const dto = await service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID);

      expect(mockManager.create).toHaveBeenCalledWith(SupportReplySuggestion, {
        issue: expect.objectContaining({ id: ISSUE_ID }),
        message: expect.objectContaining({ id: 100 }),
        text: 'Answer',
        authorId: AUTHOR_ID,
        state: SupportReplySuggestionState.PENDING,
      });
      expect(dto).toEqual({
        id: 5,
        text: 'Answer',
        state: SupportReplySuggestionState.PENDING,
        messageId: 100,
        isStale: false,
        created: new Date('2026-08-08T12:00:00Z'),
        handled: undefined,
      });
    });

    it('accepts a messageId that is the newest message', async () => {
      const dto = await service.createSuggestion(ISSUE_ID, { text: 'Answer', messageId: 100 }, AUTHOR_ID);

      expect(dto.messageId).toEqual(100);
    });

    // The check runs against the thread as it stands inside the lock, not against what was read
    // before it: a message arriving in between must not slip past a `messageId` that was still
    // current when the producer sent it.
    it('rejects a messageId the thread moved past while the submission was in flight', async () => {
      mockManager.findOne.mockResolvedValue(message(101));

      const call = service.createSuggestion(ISSUE_ID, { text: 'Answer', messageId: 100 }, AUTHOR_ID);

      await expect(call).rejects.toThrow(ConflictException);
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('rejects a messageId that the conversation has moved past', async () => {
      const call = service.createSuggestion(ISSUE_ID, { text: 'Answer', messageId: 99 }, AUTHOR_ID);

      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow('Message 99 is not the newest message of the support issue');
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    // Two submissions arriving together must not both end up Pending: the issue row is locked for
    // the whole supersede-and-insert, and the supersede is one conditional statement rather than a
    // read followed by a write.
    it('supersedes what is pending and inserts under one lock on the issue', async () => {
      await service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID);

      expect(mockManager.createQueryBuilder).toHaveBeenCalledWith(SupportIssue, 'issue');
      expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write', undefined, ['issue']);
      expect(queryBuilder.update).toHaveBeenCalledWith(SupportReplySuggestion);
      expect(supersedeUpdate()).toEqual(
        expect.objectContaining({ state: SupportReplySuggestionState.SUPERSEDED, handled: expect.any(Date) }),
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('state = :state', {
        state: SupportReplySuggestionState.PENDING,
      });
      expect(queryBuilder.execute).toHaveBeenCalled();
      expect(suggestionRepo.delete).not.toHaveBeenCalled();
    });

    it('fails when the issue does not exist', async () => {
      supportIssueRepo.findOne.mockResolvedValue(null);

      await expect(service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fails when the issue has no message to answer', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('getPendingSuggestion', () => {
    it('returns nothing when no suggestion awaits a decision', async () => {
      suggestionRepo.findOne.mockResolvedValue(null);

      await expect(service.getPendingSuggestion(ISSUE_ID)).resolves.toBeUndefined();
    });

    it('returns the newest pending suggestion', async () => {
      suggestionRepo.findOne.mockResolvedValue(suggestion({ id: 3, message: message(100) }));

      const dto = await service.getPendingSuggestion(ISSUE_ID);

      expect(suggestionRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { issue: { id: ISSUE_ID }, state: SupportReplySuggestionState.PENDING },
          order: { id: 'DESC' },
        }),
      );
      expect(dto).toEqual(expect.objectContaining({ id: 3, messageId: 100, isStale: false }));
    });

    it('marks a suggestion the conversation has moved past as stale', async () => {
      suggestionRepo.findOne.mockResolvedValue(suggestion({ id: 3, message: message(80) }));
      messageRepo.findOne.mockResolvedValue(message(100));

      const dto = await service.getPendingSuggestion(ISSUE_ID);

      expect(dto.isStale).toBe(true);
    });
  });

  describe.each([
    ['acceptSuggestion' as const, SupportReplySuggestionState.ACCEPTED],
    ['rejectSuggestion' as const, SupportReplySuggestionState.REJECTED],
  ])('%s', (method, expectedState) => {
    it(`records the decision as ${expectedState}`, async () => {
      const entity = suggestion({ id: 3, message: message(100) });
      queryBuilder.getOne.mockResolvedValue(entity);

      const dto = await service[method](ISSUE_ID, 3, CLERK_ID);

      expect(mockManager.update).toHaveBeenCalledWith(
        SupportReplySuggestion,
        3,
        expect.objectContaining({ state: expectedState, handledById: CLERK_ID }),
      );
      expect(dto).toEqual(expect.objectContaining({ id: 3, state: expectedState, handled: entity.handled }));
      expect(entity.handled).toBeInstanceOf(Date);
    });

    // A decision is taken once. Reading, checking and writing share a transaction under a row lock,
    // so a second call cannot slip between the check and the write and overwrite the first decision.
    it('reads the suggestion within its own issue, under a row lock', async () => {
      queryBuilder.getOne.mockResolvedValue(suggestion({ id: 3, message: message(100) }));

      await service[method](ISSUE_ID, 3, CLERK_ID);

      expect(mockManager.createQueryBuilder).toHaveBeenCalledWith(SupportReplySuggestion, 'suggestion');
      expect(queryBuilder.where).toHaveBeenCalledWith('suggestion.id = :suggestionId', { suggestionId: 3 });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('issue.id = :issueId', { issueId: ISSUE_ID });
      expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write', undefined, ['suggestion']);
    });

    it('fails when the suggestion does not exist', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      await expect(service[method](ISSUE_ID, 3, CLERK_ID)).rejects.toThrow(NotFoundException);
    });

    it('fails when the suggestion was already decided', async () => {
      queryBuilder.getOne.mockResolvedValue(
        suggestion({ id: 3, message: message(100), state: SupportReplySuggestionState.ACCEPTED }),
      );

      const call = service[method](ISSUE_ID, 3, CLERK_ID);

      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow('Suggestion is already in state Accepted');
      expect(mockManager.update).not.toHaveBeenCalled();
    });
  });
});
