import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { rolesSatisfying } from 'src/shared/auth/role.guard';
import { KycGatedRoles } from 'src/shared/auth/user-role.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxCron } from 'src/shared/utils/cron';
import { In, Raw } from 'typeorm';
import { UserRepository } from './user.repository';

// Roles that can reach a KYC-gated endpoint: the gated entry roles plus their super-roles (e.g.
// SUPER_ADMIN, which satisfies every gate but is not itself listed in KycGatedRoles). Derived, not
// hand-written — a role added to the hierarchy must not silently fall out of the clearance sync and
// lose access.
const ClearanceRelevantRoles = rolesSatisfying(KycGatedRoles);

// Every character `String.prototype.trim()` strips (ECMAScript WhiteSpace + LineTerminator). Postgres'
// bare `TRIM(x)` removes ASCII space ONLY, so a name of a single tab or a non-breaking space would pass
// a `TRIM(x) <> ''` test and clear an account that carries no identification at all. The set is spelled
// out rather than left to `[[:space:]]`, whose meaning depends on the database locale.
//
// U+200B (zero width space) is deliberately NOT in here: `trim()` does not strip it either, so adding it
// would make this predicate stricter than the check it replaced. Whether a name made of invisible
// characters that `trim()` ignores should count as identification is a question about how verifiedName is
// written, not about this gate.
export const BlankChars =
  '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007' +
  '\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

// Exported so the Postgres suite can execute this exact predicate against a real database — a mocked
// repository never runs the fragment, and the ASCII-only default of `TRIM` is invisible without one.
export function nonBlankPredicate(alias: string): string {
  return `BTRIM(${alias}, :blankChars) <> ''`;
}

// Maintains the `staffKycClearance` setting: the account (user data) ids allowed onto elevated
// endpoints. `ProcessService` primes the in-memory Set from it and `RoleGuard` enforces it — see
// `HasStaffKycClearance` for the fail-closed semantics.
//
// Mirrors JwtRevocationSyncService: the cron lives in the user domain (which owns User/UserData) to
// keep the shared ProcessService/SettingService free of subdomain dependencies. Self-healing in both
// directions — losing the verified name or losing the staff role drops the account out of the query
// and thus out of the setting on the next run.
@Injectable()
export class StaffKycClearanceService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly settingService: SettingService,
  ) {}

  // Every minute, matching JwtRevocationSyncService: revoking elevated access promptly is a security
  // requirement and warrants the same exception to the "prefer 15min" cron guideline.
  @DfxCron(CronExpression.EVERY_MINUTE, { timeout: 1800 })
  async syncStaffKycClearance(): Promise<void> {
    const staffUsers = await this.userRepo.find({
      select: { id: true, userData: { id: true } },
      where: {
        role: In(ClearanceRelevantRoles),
        userData: {
          // A non-empty verified name is the sole clearance condition: it is only ever set by an
          // identity-verified path or a reviewed migration, never self-service (see the write paths of
          // `verifiedName`). Personal accounts carry an identity-verified name; operator-reviewed service
          // accounts carry a non-personal designation. A KYC level is deliberately NOT required — it is
          // unreachable for the DEBUG role and impossible for service accounts that legitimately hold a
          // gated role.
          //
          // `verifiedName IS NOT NULL` is the stated rule, but an empty or blank name carries no
          // identification either — the predicate covers both, and NULL drops out on its own because the
          // comparison yields NULL. See BlankChars for why the character set is explicit.
          verifiedName: Raw(nonBlankPredicate, { blankChars: BlankChars }),
        },
      },
      relations: { userData: true },
    });

    const clearedAccounts = staffUsers.map((user) => user.userData.id);

    await this.settingService.setObj('staffKycClearance', [...new Set(clearedAccounts)]);
  }
}
