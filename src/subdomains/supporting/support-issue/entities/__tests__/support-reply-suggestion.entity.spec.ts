import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportMessage } from 'src/subdomains/supporting/support-issue/entities/support-message.entity';
import { SupportReplySuggestion } from 'src/subdomains/supporting/support-issue/entities/support-reply-suggestion.entity';
import { SupportReplySuggestionState } from 'src/subdomains/supporting/support-issue/enums/support-reply-suggestion.enum';
import { getMetadataArgsStorage } from 'typeorm';

const entity = (state: SupportReplySuggestionState): SupportReplySuggestion =>
  Object.assign(new SupportReplySuggestion(), { id: 3, state });

describe('SupportReplySuggestion', () => {
  describe('setState', () => {
    it('returns the id and the changed fields, and applies them to the entity', () => {
      const suggestion = entity(SupportReplySuggestionState.PENDING);

      const [id, update] = suggestion.setState(SupportReplySuggestionState.ACCEPTED, 9);

      expect(id).toEqual(3);
      expect(update.state).toEqual(SupportReplySuggestionState.ACCEPTED);
      expect(update.handledById).toEqual(9);
      expect(update.handled).toBeInstanceOf(Date);
      expect(suggestion.state).toEqual(SupportReplySuggestionState.ACCEPTED);
      expect(suggestion.handledById).toEqual(9);
    });

    it('records a transition nobody decided, such as being superseded', () => {
      const suggestion = entity(SupportReplySuggestionState.PENDING);

      const [, update] = suggestion.setState(SupportReplySuggestionState.SUPERSEDED);

      expect(update.state).toEqual(SupportReplySuggestionState.SUPERSEDED);
      expect(update.handledById).toBeUndefined();
      expect(update.handled).toBeInstanceOf(Date);
    });
  });

  // TypeORM keeps the relation type thunks in the global metadata-args storage; invoking them runs
  // the arrow expressions on the entity and asserts each relation points at the right entity — the
  // suggestion is worthless if it is not tied to exactly one issue and one message.
  describe('relations', () => {
    const relationType = (propertyName: string): unknown => {
      const relation = getMetadataArgsStorage().relations.find(
        (r) => r.target === SupportReplySuggestion && r.propertyName === propertyName,
      );
      return (relation.type as () => unknown)();
    };

    it('joins issue to SupportIssue', () => {
      expect(relationType('issue')).toBe(SupportIssue);
    });

    it('joins message to SupportMessage', () => {
      expect(relationType('message')).toBe(SupportMessage);
    });
  });

  describe('isPending', () => {
    it.each([
      [SupportReplySuggestionState.PENDING, true],
      [SupportReplySuggestionState.ACCEPTED, false],
      [SupportReplySuggestionState.REJECTED, false],
      [SupportReplySuggestionState.SUPERSEDED, false],
    ])('is %s -> %s', (state, expected) => {
      expect(entity(state).isPending).toBe(expected);
    });
  });
});
