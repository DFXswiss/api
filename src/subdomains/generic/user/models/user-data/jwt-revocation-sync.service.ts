import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { In } from 'typeorm';
import { RiskStatus, UserDataStatus } from './user-data.enum';
import { UserDataRepository } from './user-data.repository';

// Auto-populates the `jwtAccountDenylistAuto` setting from the DB so that blocking or deactivating an
// account revokes its live JWTs without a manual denylist edit. Every user token (wallet-signature and
// mail/account) carries the userDataId as `account`, so an account-id denylist revokes all of a blocked
// user's tokens. `ProcessService` primes the in-memory denied-account Set from
// `SettingService.getDeniedJwtAccounts()` (which unions this auto setting with the manual override), and
// `JwtStrategy.validate` rejects any token whose account is denied. Reactivation self-heals: a reactivated
// account drops out of the query and is removed from the setting on the next run.
//
// This cron lives in the user domain (owns UserData) to keep the shared `ProcessService`/`SettingService`
// free of subdomain dependencies.
@Injectable()
export class JwtRevocationSyncService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly settingService: SettingService,
  ) {}

  // Runs every minute: fast revocation of a blocked or compromised account is a security requirement that
  // warrants the security-revocation exception to the "prefer 15min" cron guideline.
  //
  // And deliberately WITHOUT a `process` flag, for the same reason and matching
  // StaffKycClearanceService::syncStaffKycClearance, which states it there. A flag is a switch that
  // turns the job off in the database, `DISABLED_PROCESSES='*'` turns off everything that has one,
  // and switched off this job does not empty the auto denylist — it stops writing to it. Accounts
  // blocked after that keep their live JWTs, and nothing reports it: the role heartbeat goes on
  // saying `lease ok`. A switch whose use is silent does not belong on a revocation path.
  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, timeout: 1800 })
  async syncDeniedJwtAccounts(): Promise<void> {
    const blockedAccounts = await this.userDataRepo.find({
      select: { id: true },
      where: [
        { status: In([UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED]) },
        { riskStatus: In([RiskStatus.BLOCKED, RiskStatus.SUSPICIOUS]) },
      ],
    });

    await this.settingService.setObj(
      'jwtAccountDenylistAuto',
      blockedAccounts.map((account) => account.id),
    );
  }
}
