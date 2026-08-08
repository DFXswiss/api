import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SupportMessage } from 'src/subdomains/supporting/support-issue/entities/support-message.entity';
import { SupportReplySuggestionState } from 'src/subdomains/supporting/support-issue/enums/support-reply-suggestion.enum';
import { SupportIssueRepository } from 'src/subdomains/supporting/support-issue/repositories/support-issue.repository';
import { SupportMessageRepository } from 'src/subdomains/supporting/support-issue/repositories/support-message.repository';
import { SupportReplySuggestionService } from 'src/subdomains/supporting/support-issue/services/support-reply-suggestion.service';
import { IsNull } from 'typeorm';

const ISSUE_ID = 42;
const MESSAGE_ID = 100;
const AUTHOR_ID = 7;
const CLERK_ID = 9;

const message = (values: Partial<SupportMessage> = {}): SupportMessage =>
  Object.assign(new SupportMessage(), { id: MESSAGE_ID, author: 'Customer', ...values });

const withSuggestion = (values: Partial<SupportMessage> = {}): SupportMessage =>
  message({
    suggestionText: 'Please check again',
    suggestionState: SupportReplySuggestionState.PENDING,
    suggestionAuthorId: AUTHOR_ID,
    suggestionCreated: new Date('2026-08-08T10:00:00Z'),
    ...values,
  });

describe('SupportReplySuggestionService', () => {
  let service: SupportReplySuggestionService;
  let messageRepo: DeepMocked<SupportMessageRepository>;
  let issueRepo: DeepMocked<SupportIssueRepository>;

  /** What the conditional write was addressed to, and what it set. */
  const updateCriteria = (): Record<string, unknown> => (messageRepo.update as jest.Mock).mock.calls[0][0];
  const updateValues = (): Record<string, unknown> => (messageRepo.update as jest.Mock).mock.calls[0][1];

  beforeEach(() => {
    messageRepo = createMock<SupportMessageRepository>();
    messageRepo.findOne.mockResolvedValue(message());
    (messageRepo.update as jest.Mock).mockResolvedValue({ affected: 1 });
    issueRepo = createMock<SupportIssueRepository>();
    issueRepo.existsBy.mockResolvedValue(false);

    service = new SupportReplySuggestionService(messageRepo, issueRepo);
  });

  describe('createSuggestion', () => {
    it('writes the suggestion onto the newest message of the thread', async () => {
      const dto = await service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID);

      expect(updateCriteria()).toEqual({ id: MESSAGE_ID, suggestionText: IsNull() });
      expect(updateValues()).toEqual(
        expect.objectContaining({
          suggestionText: 'Answer',
          suggestionState: SupportReplySuggestionState.PENDING,
          suggestionAuthorId: AUTHOR_ID,
        }),
      );
      expect(dto).toEqual({
        messageId: MESSAGE_ID,
        text: 'Answer',
        state: SupportReplySuggestionState.PENDING,
        isStale: false,
        created: expect.any(Date),
        handled: undefined,
      });
    });

    it('accepts a messageId that is the newest message', async () => {
      const dto = await service.createSuggestion(ISSUE_ID, { text: 'Answer', messageId: MESSAGE_ID }, AUTHOR_ID);

      expect(dto.messageId).toEqual(MESSAGE_ID);
    });

    it('rejects a messageId that the conversation has moved past', async () => {
      const call = service.createSuggestion(ISSUE_ID, { text: 'Answer', messageId: 99 }, AUTHOR_ID);

      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow('Message 99 is not the newest message of the support issue');
      expect(messageRepo.update).not.toHaveBeenCalled();
    });

    // Two submissions arriving together both find the message empty; the condition on the column is
    // what makes the second one lose rather than overwrite the first.
    it('refuses a message that already carries a suggestion', async () => {
      (messageRepo.update as jest.Mock).mockResolvedValue({ affected: 0 });

      const call = service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID);

      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow(`Message ${MESSAGE_ID} already carries a suggestion`);
    });

    it('fails when the issue does not exist', async () => {
      messageRepo.findOne.mockResolvedValue(null);

      const call = service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID);

      await expect(call).rejects.toThrow(NotFoundException);
      await expect(call).rejects.toThrow('Support issue not found');
    });

    // An issue is written before the message it is created with, and that message can still be
    // refused — so nothing to answer is not the same as nothing there.
    it('fails with a conflict when the issue exists but has no message', async () => {
      messageRepo.findOne.mockResolvedValue(null);
      issueRepo.existsBy.mockResolvedValue(true);

      const call = service.createSuggestion(ISSUE_ID, { text: 'Answer' }, AUTHOR_ID);

      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow('Support issue has no message to answer');
    });
  });

  describe('getPendingSuggestion', () => {
    it('returns nothing when no suggestion awaits a decision', async () => {
      messageRepo.findOne.mockResolvedValue(null);

      await expect(service.getPendingSuggestion(ISSUE_ID)).resolves.toBeUndefined();
    });

    it('returns the newest message that carries a pending suggestion', async () => {
      messageRepo.findOne.mockResolvedValue(withSuggestion());

      const dto = await service.getPendingSuggestion(ISSUE_ID);

      expect(messageRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { issue: { id: ISSUE_ID }, suggestionState: SupportReplySuggestionState.PENDING },
          order: { id: 'DESC' },
        }),
      );
      expect(dto).toEqual(expect.objectContaining({ messageId: MESSAGE_ID, isStale: false }));
    });

    it('marks a suggestion the conversation has moved past as stale', async () => {
      messageRepo.findOne
        .mockResolvedValueOnce(withSuggestion({ id: 80 }))
        .mockResolvedValueOnce(message({ id: MESSAGE_ID }));

      const dto = await service.getPendingSuggestion(ISSUE_ID);

      expect(dto.isStale).toBe(true);
    });
  });

  describe.each([
    ['acceptSuggestion' as const, SupportReplySuggestionState.ACCEPTED],
    ['rejectSuggestion' as const, SupportReplySuggestionState.REJECTED],
  ])('%s', (method, expectedState) => {
    it(`records the decision as ${expectedState}`, async () => {
      const entity = withSuggestion();
      messageRepo.findOne.mockResolvedValue(entity);

      const dto = await service[method](ISSUE_ID, MESSAGE_ID, CLERK_ID);

      expect(updateValues()).toEqual(
        expect.objectContaining({ suggestionState: expectedState, suggestionHandledById: CLERK_ID }),
      );
      expect(dto).toEqual(expect.objectContaining({ messageId: MESSAGE_ID, state: expectedState }));
      expect(entity.suggestionHandled).toBeInstanceOf(Date);
    });

    // A decision is taken once: the write is addressed to a message that is still pending, so a
    // second call cannot overwrite who decided what and when.
    it('writes only to a message whose suggestion is still pending', async () => {
      messageRepo.findOne.mockResolvedValue(withSuggestion());

      await service[method](ISSUE_ID, MESSAGE_ID, CLERK_ID);

      expect(messageRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: MESSAGE_ID, issue: { id: ISSUE_ID } } }),
      );
      expect(updateCriteria()).toEqual({ id: MESSAGE_ID, suggestionState: SupportReplySuggestionState.PENDING });
    });

    it('marks the decided suggestion as stale when the thread has moved past it', async () => {
      messageRepo.findOne
        .mockResolvedValueOnce(withSuggestion())
        .mockResolvedValueOnce(message({ id: MESSAGE_ID + 1 }));

      const dto = await service[method](ISSUE_ID, MESSAGE_ID, CLERK_ID);

      expect(dto.isStale).toBe(true);
    });

    it('fails when the message does not exist', async () => {
      messageRepo.findOne.mockResolvedValue(null);

      await expect(service[method](ISSUE_ID, MESSAGE_ID, CLERK_ID)).rejects.toThrow(NotFoundException);
    });

    it('fails when the message carries no suggestion', async () => {
      messageRepo.findOne.mockResolvedValue(message());

      await expect(service[method](ISSUE_ID, MESSAGE_ID, CLERK_ID)).rejects.toThrow(NotFoundException);
    });

    it('fails when the suggestion was already decided', async () => {
      messageRepo.findOne.mockResolvedValue(withSuggestion({ suggestionState: SupportReplySuggestionState.ACCEPTED }));
      (messageRepo.update as jest.Mock).mockResolvedValue({ affected: 0 });

      const call = service[method](ISSUE_ID, MESSAGE_ID, CLERK_ID);

      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow(`Suggestion of message ${MESSAGE_ID} was already decided`);
    });

    // The loser of two simultaneous decisions read `Pending` before the winner wrote, so the message
    // it was refused with must not name a state — it would name the one from before the race.
    it('does not name a state when the decision was lost to a simultaneous one', async () => {
      messageRepo.findOne.mockResolvedValue(withSuggestion());
      (messageRepo.update as jest.Mock).mockResolvedValue({ affected: 0 });

      await expect(service[method](ISSUE_ID, MESSAGE_ID, CLERK_ID)).rejects.toThrow(
        `Suggestion of message ${MESSAGE_ID} was already decided`,
      );
    });
  });
});
