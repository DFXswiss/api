import { SupportIssueInternalState, SupportIssueState } from 'src/subdomains/supporting/support-issue/enums/support-issue.enum';
import { SupportIssueStateMapper } from 'src/subdomains/supporting/support-issue/dto/support-issue.dto';

describe('SupportIssueStateMapper', () => {
  it('maps every internal state to a valid customer-facing state', () => {
    for (const internal of Object.values(SupportIssueInternalState)) {
      const mapped = SupportIssueStateMapper[internal];
      expect(mapped).toBeDefined();
      expect(Object.values(SupportIssueState)).toContain(mapped);
    }
  });

  it('exposes IN_CLARIFICATION to the customer', () => {
    expect(SupportIssueStateMapper[SupportIssueInternalState.IN_CLARIFICATION]).toBe(SupportIssueState.IN_CLARIFICATION);
  });

  it('exposes IN_PROGRESS to the customer', () => {
    expect(SupportIssueStateMapper[SupportIssueInternalState.IN_PROGRESS]).toBe(SupportIssueState.IN_PROGRESS);
  });

  it('hides internal-only states (CREATED, ON_HOLD) behind PENDING', () => {
    expect(SupportIssueStateMapper[SupportIssueInternalState.CREATED]).toBe(SupportIssueState.PENDING);
    expect(SupportIssueStateMapper[SupportIssueInternalState.PENDING]).toBe(SupportIssueState.PENDING);
    expect(SupportIssueStateMapper[SupportIssueInternalState.ON_HOLD]).toBe(SupportIssueState.PENDING);
  });

  it('maps terminal states directly', () => {
    expect(SupportIssueStateMapper[SupportIssueInternalState.COMPLETED]).toBe(SupportIssueState.COMPLETED);
    expect(SupportIssueStateMapper[SupportIssueInternalState.CANCELED]).toBe(SupportIssueState.CANCELED);
  });
});
