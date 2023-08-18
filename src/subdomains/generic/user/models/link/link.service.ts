import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Config } from 'src/config/config';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MoreThan } from 'typeorm';
import { Blank, BlankType, UserData } from '../user-data/user-data.entity';
import { UserDataService } from '../user-data/user-data.service';
import { User } from '../user/user.entity';
import { UserRepository } from '../user/user.repository';
import { LinkAddress } from './link-address.entity';
import { LinkAddressRepository } from './link-address.repository';

@Injectable()
export class LinkService {
  constructor(
    private readonly linkAddressRepo: LinkAddressRepository,
    private readonly userRepo: UserRepository,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
  ) {}

  async getLinkAddress(authentication: string): Promise<LinkAddress> {
    return this.linkAddressRepo.findOneBy({ authentication });
  }

  async createNewLinkAddress(user: UserData, completedUser: UserData): Promise<void> {
    const oldestToNewestUser = this.sortOldToNew(completedUser.users);
    const existingAddress = oldestToNewestUser[0].address;
    const newAddress = user.users[0].address;

    const existing = await this.linkAddressRepo.findOneBy({
      existingAddress,
      newAddress,
      expiration: MoreThan(new Date()),
    });
    if (existing) return;

    const linkAddress = await this.linkAddressRepo.save(LinkAddress.create(existingAddress, newAddress));

    await this.notificationService.sendMailNew({
      type: MailType.USER,
      input: {
        userData: user,
        title: `${MailTranslationKey.LINK_ADDRESS}.title`,
        salutation: { key: `${MailTranslationKey.LINK_ADDRESS}.salutation` },
        prefix: [
          { key: MailKey.SPACE, params: { value: '3' } },
          {
            key: `${MailTranslationKey.GENERAL}.welcome`,
            params: { name: completedUser.organizationName ?? completedUser.firstname },
          },
          { key: MailKey.SPACE, params: { value: '2' } },
          {
            key: `${MailTranslationKey.LINK_ADDRESS}.message`,
            params: { url: this.buildLinkUrl(linkAddress.authentication) },
          },
          { key: MailKey.SPACE, params: { value: '4' } },
        ],
        table: {
          [`${MailTranslationKey.LINK_ADDRESS}.existing_address`]: Blank(existingAddress, BlankType.WALLET_ADDRESS),
          [`${MailTranslationKey.LINK_ADDRESS}.new_address`]: Blank(newAddress, BlankType.WALLET_ADDRESS),
        },
        suffix: [{ key: MailKey.SPACE, params: { value: '4' } }, { key: MailKey.DFX_TEAM_CLOSING }],
      },
    });
  }

  async executeLinkAddress(authentication: string): Promise<LinkAddress> {
    const linkAddress = await this.getLinkAddress(authentication);
    if (!linkAddress) throw new NotFoundException('Link address information not found');

    if (linkAddress.isExpired()) throw new BadRequestException('Link address request is expired');
    if (linkAddress.isCompleted) throw new ConflictException('Link address request is already completed');

    const existingUser = await this.userRepo.getByAddress(linkAddress.existingAddress, true);
    if (!existingUser) throw new NotFoundException('User not found');

    const userToBeLinked = await this.userRepo.getByAddress(linkAddress.newAddress, true);
    if (!userToBeLinked) throw new NotFoundException('User not found');

    if (existingUser.userData.id !== userToBeLinked.userData.id) {
      await this.userDataService.mergeUserData(existingUser.userData.id, userToBeLinked.userData.id);
    }

    await this.linkAddressRepo.save(linkAddress.complete());

    return linkAddress;
  }

  private sortOldToNew(users: User[]): User[] {
    return users.sort((a, b) => (a.created > b.created ? 1 : -1));
  }

  private buildLinkUrl(authentication: string): string {
    return `${Config.payment.url}/link?authentication=${authentication}`;
  }
}
