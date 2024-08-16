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
import { AccountMerge } from './account-merge.entity';
import { AccountMergeRepository } from './account-merge.repository';

@Injectable()
export class AccountMergeService {
  constructor(
    private readonly accountMergeRepo: AccountMergeRepository,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
  ) {}

  async sendMergeRequest(master: UserData, slave: UserData): Promise<boolean> {
    if (!slave.mail) return false;
    try {
      master.checkIfMergePossibleWith(slave);
    } catch {
      return false;
    }
    const request =
      (await this.accountMergeRepo.findOne({
        where: {
          master: { id: master.id },
          slave: { id: slave.id },
          expiration: MoreThan(new Date()),
        },
        relations: { master: true, slave: true },
      })) ?? (await this.accountMergeRepo.save(AccountMerge.create(master, slave)));

    const url = this.buildConfirmationUrl(request.code);
    await this.notificationService.sendMail({
      type: MailType.USER,
      context: MailContext.ACCOUNT_MERGE_REQUEST,
      input: {
        userData: request.slave,
        title: `${MailTranslationKey.ACCOUNT_MERGE_REQUEST}.title`,
        salutation: { key: `${MailTranslationKey.ACCOUNT_MERGE_REQUEST}.salutation` },
        prefix: [
          { key: MailKey.SPACE, params: { value: '3' } },
          {
            key: `${MailTranslationKey.GENERAL}.welcome`,
            params: { name: request.master.organizationName ?? request.master.firstname },
          },
          { key: MailKey.SPACE, params: { value: '2' } },
          {
            key: `${MailTranslationKey.ACCOUNT_MERGE_REQUEST}.message`,
            params: { url, urlText: url },
          },
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
    const request = await this.accountMergeRepo.findOne({
      where: { code },
      relations: { master: { users: true }, slave: { users: true } },
    });
    if (!request) throw new NotFoundException('Account merge information not found');

    if (request.isExpired) throw new BadRequestException('Merge request is expired');
    if (request.isCompleted) throw new ConflictException('Merge request is already completed');

    await this.userDataService.mergeUserData(request.master.id, request.slave.id);

    return this.accountMergeRepo.save(request.complete());
  }

  private buildConfirmationUrl(code: string): string {
    return `${Config.frontend.services}/kyc?merge-code=${code}`;
  }
}
