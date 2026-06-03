import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MoreThan } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';
import { UserDataService } from '../user-data/user-data.service';
import { AccountMerge, MergeReason } from './account-merge.entity';
import { AccountMergeRepository } from './account-merge.repository';

@Injectable()
export class AccountMergeService {
  // Only an open merge request touched within this window is reused; older open requests are left
  // alone so a deliberate re-initiation gets a fresh mail instead of being silently swallowed.
  private static readonly mergeRequestDedupWindowMinutes = 5;

  constructor(
    private readonly accountMergeRepo: AccountMergeRepository,
    private readonly notificationService: NotificationService,
    private readonly kycLogService: KycLogService,
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
  ) {}

  static masterFirst(users: UserData[]): UserData[] {
    return users.sort((a, b) => {
      if (a.identDocumentId) return -1;
      if (b.identDocumentId) return 1;
      if (a.kycLevel >= 20 || b.kycLevel >= 20 || (!a.surname && !b.surname)) return b.kycLevel - a.kycLevel;
      if (a.surname && !b.surname) return -1;
      if (!a.surname && b.surname) return 1;
    });
  }

  async sendMergeRequest(
    master: UserData,
    slave: UserData,
    reason: MergeReason,
    sendToSlave = false,
  ): Promise<boolean> {
    if (!master.isMergePossibleWith(slave)) return false;

    // Dedup at the entry: several code paths request the same logical merge (ident verification +
    // re-check, IBAN conflict, mail change). If an open merge for this pair already exists, the
    // original mail already pointed the user to the confirmation URL — reuse it instead of minting
    // a new row (which would get a fresh correlationId and slip past the mail-layer debounce).
    //
    // The reuse window is bounded to recent requests only (`updated` within the last few minutes):
    // an open request lives until its expiration (30d for IDENT/IBAN), but dedup should suppress the
    // near-simultaneous trigger burst — not a user who deliberately re-initiates the flow hours or
    // days later and legitimately expects a fresh mail.
    const openRequest = await this.accountMergeRepo.findOneBy({
      master: { id: master.id },
      slave: { id: slave.id },
      isCompleted: false,
      expiration: MoreThan(new Date()),
      updated: MoreThan(Util.minutesBefore(AccountMergeService.mergeRequestDedupWindowMinutes)),
    });
    if (openRequest) {
      // keep the audit trail of which trigger reasons hit an already-open merge
      const reuseMessage = `Merge request ${openRequest.id} reused (reason ${reason}): master ${master.id}, slave ${slave.id}`;
      await this.kycLogService.createMergeLog(master, reuseMessage);
      await this.kycLogService.createMergeLog(slave, reuseMessage);
      return true;
    }

    const request = await this.accountMergeRepo.save(AccountMerge.create(master, slave, reason));

    const [receiver, mentioned] = sendToSlave ? [slave, master] : [master, slave];
    if (!receiver.mail) return false;

    const name = mentioned.organizationName ?? mentioned.firstname ?? receiver.organizationName ?? receiver.firstname;
    const url = this.buildConfirmationUrl(request.code);

    await this.notificationService.sendMail({
      type: MailType.USER_V2,
      context: MailContext.ACCOUNT_MERGE_REQUEST,
      input: {
        userData: receiver,
        title: `${MailTranslationKey.ACCOUNT_MERGE_REQUEST}.title`,
        salutation: { key: `${MailTranslationKey.ACCOUNT_MERGE_REQUEST}.salutation` },
        texts: [
          { key: MailKey.SPACE, params: { value: '3' } },
          { key: `${MailTranslationKey.GENERAL}.welcome`, params: { name } },
          { key: MailKey.SPACE, params: { value: '2' } },
          {
            key: `${MailTranslationKey.GENERAL}.button`,
            params: { url, button: 'true' },
          },
          {
            key: `${MailTranslationKey.ACCOUNT_MERGE_REQUEST}.message`,
            params: { url, urlText: url },
          },
          { key: MailKey.SPACE, params: { value: '2' } },
          { key: MailKey.DFX_TEAM_CLOSING },
        ],
      },
      options: { debounce: 60000 },
      correlationId: `${request.id}`,
    });

    const logMessage = `Merge request ${request.id} sent: master ${master.id} (${master.mail}), slave ${slave.id} (${slave.mail}), reason ${reason}`;
    await this.kycLogService.createMergeLog(master, logMessage);
    await this.kycLogService.createMergeLog(slave, logMessage);

    return true;
  }

  async executeMerge(code: string): Promise<AccountMerge> {
    const request = await this.accountMergeRepo.findOne({ where: { code }, relations: { master: true, slave: true } });
    if (!request) throw new NotFoundException('Account merge information not found');

    if (request.isExpired) throw new BadRequestException('Merge request is expired');
    if (request.isCompleted) throw new ConflictException('Merge request is already completed');

    const [master, slave] = AccountMergeService.masterFirst([request.master, request.slave]);

    const logMessage = `Merge request ${request.id} confirmed: master ${master.id} (${master.mail}), slave ${slave.id} (${slave.mail}), reason ${request.reason}`;
    await this.kycLogService.createMergeLog(master, logMessage);
    await this.kycLogService.createMergeLog(slave, logMessage);

    await this.userDataService.mergeUserData(master.id, slave.id, request.slave.mail);

    await this.accountMergeRepo.update(...request.complete(master, slave));

    return request;
  }

  async pendingMergeRequest(userDataId: number, referenceUserDataId: number): Promise<AccountMerge> {
    return this.accountMergeRepo.findOneBy([
      { master: { id: userDataId }, slave: { id: referenceUserDataId }, isCompleted: false },
      { master: { id: referenceUserDataId }, slave: { id: userDataId }, isCompleted: false },
    ]);
  }

  private buildConfirmationUrl(code: string): string {
    return `${Config.frontend.services}/account-merge?otp=${code}`;
  }
}
