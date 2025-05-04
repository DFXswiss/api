import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Config } from 'src/config/config';
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
  constructor(
    private readonly accountMergeRepo: AccountMergeRepository,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
  ) {}

  static masterFirst(users: UserData[]): UserData[] {
    return users.sort((a, b) => {
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

    const request =
      (await this.accountMergeRepo.findOne({
        where: {
          master: { id: master.id },
          slave: { id: slave.id },
          expiration: MoreThan(new Date()),
        },
        relations: { master: true, slave: true },
      })) ?? (await this.accountMergeRepo.save(AccountMerge.create(master, slave, reason)));

    const [receiver, mentioned] = sendToSlave ? [request.slave, request.master] : [request.master, request.slave];
    if (!receiver.mail) return false;

    const name = mentioned.organizationName ?? mentioned.firstname ?? receiver.organizationName ?? receiver.firstname;
    const url = this.buildConfirmationUrl(request.code);

    await this.notificationService.sendMail({
      type: MailType.USER,
      context: MailContext.ACCOUNT_MERGE_REQUEST,
      input: {
        userData: receiver,
        wallet: receiver.wallet,
        title: `${MailTranslationKey.ACCOUNT_MERGE_REQUEST}.title`,
        salutation: { key: `${MailTranslationKey.ACCOUNT_MERGE_REQUEST}.salutation` },
        prefix: [
          { key: MailKey.SPACE, params: { value: '3' } },
          {
            key: `${MailTranslationKey.GENERAL}.welcome`,
            params: { name },
          },
          { key: MailKey.SPACE, params: { value: '2' } },
          {
            key: `${MailTranslationKey.ACCOUNT_MERGE_REQUEST}.message`,
            params: { url, urlText: url },
          },
          { key: MailKey.SPACE, params: { value: '2' } },
          { key: `${MailTranslationKey.ACCOUNT_MERGE_REQUEST}.closing` },
          { key: MailKey.SPACE, params: { value: '4' } },
        ],
        suffix: [{ key: MailKey.SPACE, params: { value: '4' } }, { key: MailKey.DFX_TEAM_CLOSING }],
      },
      options: { debounce: 60000 },
      correlationId: `${request.id}`,
    });

    return true;
  }

  async executeMerge(code: string): Promise<AccountMerge> {
    const request = await this.accountMergeRepo.findOne({ where: { code }, relations: { master: true, slave: true } });
    if (!request) throw new NotFoundException('Account merge information not found');

    if (request.isExpired) throw new BadRequestException('Merge request is expired');
    if (request.isCompleted) throw new ConflictException('Merge request is already completed');

    const [master, slave] = AccountMergeService.masterFirst([request.master, request.slave]);

    await this.userDataService.mergeUserData(master.id, slave.id, request.slave.mail);

    await this.accountMergeRepo.update(...request.complete(master, slave));

    return request;
  }

  private buildConfirmationUrl(code: string): string {
    return `${Config.frontend.services}/account-merge?otp=${code}`;
  }
}
