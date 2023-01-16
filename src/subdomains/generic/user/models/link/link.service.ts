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
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
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
    return this.linkAddressRepo.findOne({
      where: { authentication },
    });
  }

  async createNewLinkAddress(user: UserData, completedUser: UserData): Promise<void> {
    const oldestToNewestUser = this.sortOldToNew(completedUser.users);
    const existingAddress = oldestToNewestUser[0].address;
    const newAddress = user.users[0].address;

    const linkAddress = await this.linkAddressRepo.save(LinkAddress.create(existingAddress, newAddress));

    await this.notificationService.sendMail({
      type: MailType.USER,
      input: {
        userData: user,
        translationKey: 'mail.link.address',
        translationParams: {
          firstname: completedUser.firstname,
          surname: completedUser.surname,
          organizationName: completedUser.organizationName ?? '',
          existingAddress: Blank(existingAddress, BlankType.WALLET_ADDRESS),
          newAddress: Blank(newAddress, BlankType.WALLET_ADDRESS),
          url: this.buildLinkUrl(linkAddress.authentication),
        },
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

    await this.userDataService.mergeUserData(existingUser.userData.id, userToBeLinked.userData.id);
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
