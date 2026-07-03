import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { LimitRequest } from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { Department } from 'src/subdomains/supporting/support-issue/enums/department.enum';
import {
  SupportIssueInternalState,
  SupportIssueReason,
  SupportIssueType,
} from 'src/subdomains/supporting/support-issue/enums/support-issue.enum';
import { SupportIssueDtoMapper } from 'src/subdomains/supporting/support-issue/dto/support-issue-dto.mapper';

describe('SupportIssueDtoMapper.mapSupportIssueData limitRequest redaction', () => {
  // mirrors the role -> flag rule in SupportIssueService.getIssueData: DFX Support staff and RealUnit tenant staff
  // must not see the DFX AML-internal limit request; Compliance / Admin do.
  const hideLimitRequest = (role: UserRole): boolean => [UserRole.SUPPORT, UserRole.REALUNIT].includes(role);

  function makeIssue(): SupportIssue {
    return Object.assign(new SupportIssue(), {
      id: 1,
      created: new Date('2026-01-01T00:00:00.000Z'),
      uid: 'Iabc',
      type: SupportIssueType.GENERIC_ISSUE,
      department: Department.COMPLIANCE,
      reason: SupportIssueReason.OTHER,
      state: SupportIssueInternalState.PENDING,
      name: 'Help',
      clerk: 'Alice',
      userData: Object.assign(new UserData(), { id: 42 }),
      limitRequest: Object.assign(new LimitRequest(), { id: 7, limit: 100000 }),
    });
  }

  it.each([UserRole.SUPPORT, UserRole.REALUNIT])('hides the limit request for %s staff', (role) => {
    const dto = SupportIssueDtoMapper.mapSupportIssueData(makeIssue(), hideLimitRequest(role));
    expect(dto.limitRequest).toBeUndefined();
  });

  it.each([UserRole.COMPLIANCE, UserRole.ADMIN])('exposes the limit request for %s', (role) => {
    const dto = SupportIssueDtoMapper.mapSupportIssueData(makeIssue(), hideLimitRequest(role));
    expect(dto.limitRequest).toBeDefined();
    expect(dto.limitRequest?.id).toBe(7);
  });
});
