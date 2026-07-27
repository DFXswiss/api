import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { rolesSatisfying } from 'src/shared/auth/role.guard';
import { KycGatedRoles } from 'src/shared/auth/user-role.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxCron } from 'src/shared/utils/cron';
import { In, MoreThanOrEqual } from 'typeorm';
import { KycLevel } from '../user-data/user-data.enum';
import { UserRepository } from './user.repository';

// Roles that can reach a KYC-gated endpoint: the gated entry roles plus their super-roles (e.g.
// SUPER_ADMIN, which satisfies every gate but is not itself listed in KycGatedRoles). Derived, not
// hand-written — a role added to the hierarchy must not silently fall out of the clearance sync and
// lose access.
const ClearanceRelevantRoles = rolesSatisfying(KycGatedRoles);

// Maintains the `staffKycClearance` setting: the account (user data) ids allowed onto elevated
// endpoints. `ProcessService` primes the in-memory Set from it and `RoleGuard` enforces it — see
// `HasStaffKycClearance` for the fail-closed semantics.
//
// Mirrors JwtRevocationSyncService: the cron lives in the user domain (which owns User/UserData) to
// keep the shared ProcessService/SettingService free of subdomain dependencies. Self-healing in both
// directions — losing kycLevel, losing verifiedName, or losing the staff role drops the account out of
// the query and thus out of the setting on the next run.
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
      select: { id: true, userData: { id: true, verifiedName: true } },
      where: {
        role: In(ClearanceRelevantRoles),
        userData: { kycLevel: MoreThanOrEqual(KycLevel.LEVEL_50) },
      },
      relations: { userData: true },
    });

    // `verifiedName IS NOT NULL` is the stated rule, but an empty or whitespace-only name carries no
    // identification either — treat it as absent rather than as a cleared account.
    const clearedAccounts = staffUsers
      .filter((user) => user.userData?.verifiedName?.trim())
      .map((user) => user.userData.id);

    await this.settingService.setObj('staffKycClearance', [...new Set(clearedAccounts)]);
  }
}
