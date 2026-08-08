import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportMessage } from 'src/subdomains/supporting/support-issue/entities/support-message.entity';
import { SupportReplySuggestionState } from 'src/subdomains/supporting/support-issue/enums/support-reply-suggestion.enum';
import { getMetadataArgsStorage } from 'typeorm';

const message = (values: Partial<SupportMessage> = {}): SupportMessage =>
  Object.assign(new SupportMessage(), { id: 3, author: 'Customer', ...values });

describe('SupportMessage', () => {
  describe('setSuggestion', () => {
    it('returns the id and the changed fields, and applies them to the message', () => {
      const created = new Date('2026-08-08T10:00:00Z');
      const entity = message();

      const [id, update] = entity.setSuggestion('Please check again', 7, created);

      expect(id).toEqual(3);
      expect(update).toEqual({
        suggestionText: 'Please check again',
        suggestionState: SupportReplySuggestionState.PENDING,
        suggestionAuthorId: 7,
        suggestionCreated: created,
      });
      expect(entity.suggestionText).toEqual('Please check again');
      expect(entity.suggestionState).toEqual(SupportReplySuggestionState.PENDING);
    });
  });

  describe('decideSuggestion', () => {
    it.each([SupportReplySuggestionState.ACCEPTED, SupportReplySuggestionState.REJECTED])(
      'records the decision as %s',
      (state) => {
        const entity = message({ suggestionText: 'Answer', suggestionState: SupportReplySuggestionState.PENDING });

        const [id, update] = entity.decideSuggestion(state, 9);

        expect(id).toEqual(3);
        expect(update.suggestionState).toEqual(state);
        expect(update.suggestionHandledById).toEqual(9);
        expect(update.suggestionHandled).toBeInstanceOf(Date);
        expect(entity.suggestionState).toEqual(state);
      },
    );
  });

  describe('hasSuggestion', () => {
    it.each([
      [undefined, false],
      ['Answer', true],
    ])('text %s -> %s', (text, expected) => {
      expect(message({ suggestionText: text }).hasSuggestion).toBe(expected);
    });
  });

  describe('userData', () => {
    it('is the account of the issue the message belongs to', () => {
      const userData = Object.assign(new UserData(), { id: 42 });
      const issue = Object.assign(new SupportIssue(), { id: 7, userData });

      expect(message({ issue }).userData).toBe(userData);
    });
  });

  describe('fileName', () => {
    it('is the last segment of the stored url, decoded', () => {
      expect(message({ fileUrl: 'https://storage/issue/7/my%20receipt.pdf' }).fileName).toEqual('my receipt.pdf');
    });

    it('is undefined when the message carries no file', () => {
      expect(message().fileName).toBeUndefined();
    });
  });

  // The relation type thunk lives in TypeORM's metadata storage; invoking it runs the arrow
  // expression on the entity and asserts the message is tied to the issue entity.
  describe('relations', () => {
    it('joins issue to SupportIssue, with the messages inverse side', () => {
      const relation = getMetadataArgsStorage().relations.find(
        (r) => r.target === SupportMessage && r.propertyName === 'issue',
      );
      const issue = Object.assign(new SupportIssue(), { id: 7, messages: [] });

      expect((relation.type as () => unknown)()).toBe(SupportIssue);
      expect((relation.inverseSideProperty as (i: SupportIssue) => unknown)(issue)).toBe(issue.messages);
    });
  });
});
