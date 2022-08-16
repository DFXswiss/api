import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserDataService } from '../user-data/user-data.service';
import { UserService } from '../user/user.service';
import { LinkAddress } from './link-address.entity';
import { LinkAddressRepository } from './link-address.repository';

@Injectable()
export class LinkService {
  constructor(
    private readonly linkAddressRepo: LinkAddressRepository,
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
  ) {}

  async getLinkAddress(authentication: string): Promise<LinkAddress> {
    return this.linkAddressRepo.findOne({
      where: { authentication },
    });
  }

  async executeLinkAddress(authentication: string): Promise<LinkAddress> {
    const linkAddress = await this.getLinkAddress(authentication);
    if (!linkAddress) throw new NotFoundException('Link address information not found');

    if (linkAddress.isExpired()) throw new BadRequestException('Link address request is expired');
    if (linkAddress.isCompleted) throw new ConflictException('Link address request is already completed');

    const existingUser = await this.userService.getUserByAddress(linkAddress.existingAddress, true);
    if (!existingUser) throw new NotFoundException('User not found');

    const userToBeLinked = await this.userService.getUserByAddress(linkAddress.newAddress, true);
    if (!userToBeLinked) throw new NotFoundException('User not found');

    await this.userDataService.mergeUserData(existingUser.userData.id, userToBeLinked.userData.id);
    await this.linkAddressRepo.save(linkAddress.complete());

    return linkAddress;
  }
}
