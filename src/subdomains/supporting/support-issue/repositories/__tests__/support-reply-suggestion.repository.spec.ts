import { createMock } from '@golevelup/ts-jest';
import { SupportReplySuggestion } from 'src/subdomains/supporting/support-issue/entities/support-reply-suggestion.entity';
import { SupportReplySuggestionRepository } from 'src/subdomains/supporting/support-issue/repositories/support-reply-suggestion.repository';
import { EntityManager } from 'typeorm';

describe('SupportReplySuggestionRepository', () => {
  // A repository bound to the wrong entity type-checks and fails only at runtime, against the
  // wrong table.
  it('is bound to the suggestion entity', () => {
    const repo = new SupportReplySuggestionRepository(createMock<EntityManager>());

    expect(repo.target).toBe(SupportReplySuggestion);
  });
});
