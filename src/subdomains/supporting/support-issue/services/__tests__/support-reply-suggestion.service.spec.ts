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
import { In } from 'typeorm';

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

  beforeEach(() => {
    suggestionRepo = createMock<SupportReplySuggestionRepository>();
    supportIssueRepo = createMock<SupportIssueRepository>();
    messageRepo = createMock<SupportMessageRepository>();

    supportIssueRepo.findOne.mockResolvedValue(issue());
    messageRepo.findOne.mockResolvedValue(message(100));
    suggestionRepo.find.mockResolvedValue([]);
    (suggestionRepo.create as jest.Mock).mockImplementation((v) => Object.assign(new SupportReplySuggestion(), v));
    (suggestionRepo.save as jest.Mock).mockImplementation(async (e) =>
      Object.assign(e, { id: 5, created: new Date('2026-08-08T12:00:00Z') }),
    );

    service = new SupportReplySuggestionService(suggestionRepo, supportIssueRepo, messageRepo);
  });

  describe('createSuggestion', () => {
    it('binds the suggestion to the newest message of the thread', async () => {
      const dto = await service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID);

      expect(suggestionRepo.create).toHaveBeenCalledWith({
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

    it('rejects a messageId that the conversation has moved past', async () => {
      const call = service.createSuggestion(ISSUE_ID, { text: 'Answer', messageId: 99 }, AUTHOR_ID);

      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow('Message 99 is not the newest message of the support issue');
      expect(suggestionRepo.save).not.toHaveBeenCalled();
    });

    it('supersedes the suggestions still pending, without deleting them', async () => {
      suggestionRepo.find.mockResolvedValue([suggestion({ id: 1 }), suggestion({ id: 2 })]);

      await service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID);

      expect(suggestionRepo.update).toHaveBeenCalledWith(
        { id: In([1, 2]) },
        expect.objectContaining({ state: SupportReplySuggestionState.SUPERSEDED }),
      );
      expect(suggestionRepo.delete).not.toHaveBeenCalled();
    });

    it('does not run an update when nothing is pending', async () => {
      await service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID);

      expect(suggestionRepo.update).not.toHaveBeenCalled();
    });

    it('fails when the issue does not exist', async () => {
      supportIssueRepo.findOne.mockResolvedValue(null);

      await expect(service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fails when the issue has no message to answer', async () => {
      messageRepo.findOne.mockResolvedValue(null);

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
      suggestionRepo.findOne.mockResolvedValue(entity);

      const dto = await service[method](ISSUE_ID, 3, CLERK_ID);

      expect(suggestionRepo.update).toHaveBeenCalledWith(
        3,
        expect.objectContaining({ state: expectedState, handledById: CLERK_ID }),
      );
      expect(dto).toEqual(expect.objectContaining({ id: 3, state: expectedState, handled: entity.handled }));
      expect(entity.handled).toBeInstanceOf(Date);
    });

    it('looks the suggestion up within its own issue', async () => {
      suggestionRepo.findOne.mockResolvedValue(suggestion({ id: 3, message: message(100) }));

      await service[method](ISSUE_ID, 3, CLERK_ID);

      expect(suggestionRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 3, issue: { id: ISSUE_ID } } }),
      );
    });

    it('fails when the suggestion does not exist', async () => {
      suggestionRepo.findOne.mockResolvedValue(null);

      await expect(service[method](ISSUE_ID, 3, CLERK_ID)).rejects.toThrow(NotFoundException);
    });

    it('fails when the suggestion was already decided', async () => {
      suggestionRepo.findOne.mockResolvedValue(
        suggestion({ id: 3, message: message(100), state: SupportReplySuggestionState.ACCEPTED }),
      );

      const call = service[method](ISSUE_ID, 3, CLERK_ID);

      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow('Suggestion is already in state Accepted');
      expect(suggestionRepo.update).not.toHaveBeenCalled();
    });
  });
});
