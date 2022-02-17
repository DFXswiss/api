import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDataService } from 'src/user/models/user-data/user-data.service';
import { Util } from 'src/shared/util';
import { CfpVotes } from './dto/cfp-votes.dto';
import { UserDetailDto } from './dto/user.dto';
import { IdentService } from '../ident/ident.service';
import { CreateUserDto } from './dto/create-user.dto';
import { WalletService } from '../wallet/wallet.service';
import { Like, Not } from 'typeorm';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataService: UserDataService,
    private readonly identService: IdentService,
    private readonly walletService: WalletService,
  ) {}

  async getUser(userId: number, detailed = false): Promise<UserDetailDto> {
    const user = await this.userRepo.findOne(userId, { relations: ['userData'] });
    if (!user) throw new NotFoundException('User not found');

    return await this.toDto(user, detailed);
  }

  async getUserByAddress(address: string): Promise<User> {
    return this.userRepo.findOne({ address });
  }

  async createUser(dto: CreateUserDto, userIp: string): Promise<User> {
    let user = this.userRepo.create(dto);

    user.wallet = await this.walletService.getWalletOrDefault(dto.walletId);
    user.ip = userIp;
    user.ref = await this.getNextRef();
    user.usedRef = await this.checkRef(user, dto.usedRef);

    user = await this.userRepo.save(user);
    await this.userDataService.createUserData(user);

    return user;
  }

  async updateUser(id: number, dto: UpdateUserDto): Promise<UserDetailDto> {
    let user = await this.userRepo.findOne({ where: { id }, relations: ['userData'] });
    if (!user) throw new NotFoundException('User not found');

    // check used ref
    dto.usedRef = await this.checkRef(user, dto.usedRef);

    // update
    user = await this.userRepo.save({ ...user, ...dto });
    user.userData = await this.userDataService.updateUserSettings(user.userData, dto);

    return await this.toDto(user, true);
  }

  async updateUserInternal(id: number, update: Partial<User>): Promise<User> {
    const user = await this.userRepo.findOne(id);
    if (!user) throw new NotFoundException('User not found');

    return await this.userRepo.save({ ...user, ...update });
  }

  // --- REF --- //
  async updateRefProvision(userId: number, provision: number): Promise<number> {
    const user = await this.userRepo.findOne(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user.refFeePercent < provision) throw new BadRequestException('Ref provision can only be decreased');
    await this.userRepo.update({ id: userId }, { refFeePercent: provision });
    return provision;
  }

  async getRefUserProvision(userId: number): Promise<number | undefined> {
    const { usedRef } = await this.userRepo.findOne({ select: ['id', 'usedRef'], where: { id: userId } });
    return this.userRepo
      .findOne({ select: ['id', 'ref', 'refFeePercent'], where: { ref: usedRef } })
      .then((u) => u?.refFeePercent);
  }

  async updateRefVolume(ref: string, volume: number, credit: number): Promise<void> {
    await this.userRepo.update({ ref }, { refVolume: Util.round(volume, 0), refCredit: Util.round(credit, 0) });
  }

  private async checkRef(user: User, usedRef: string): Promise<string> {
    const refUser = await this.userRepo.findOne({ where: { ref: usedRef }, relations: ['userData'] });
    return usedRef === null ||
      usedRef === user.ref ||
      (usedRef && !refUser) ||
      user?.userData?.id === refUser?.userData?.id
      ? '000-000'
      : usedRef;
  }

  private async getNextRef(): Promise<string> {
    // get highest numerical ref
    const nextRef = await this.userRepo
      .findOne({
        select: ['id', 'ref'],
        where: { ref: Like('%[0-9]-[0-9]%') },
        order: { ref: 'DESC' },
      })
      .then((u) => +u.ref.replace('-', '') + 1);

    const ref = nextRef.toString().padStart(6, '0');
    return `${ref.slice(0, 3)}-${ref.slice(3, 6)}`;
  }

  // --- DTO --- //
  private async toDto(user: User, detailed: boolean): Promise<UserDetailDto> {
    return {
      accountType: user.userData?.accountType,
      address: user.address,
      status: user.status,
      usedRef: user.usedRef === '000-000' ? undefined : user.usedRef,
      mail: user.userData?.mail,
      phone: user.userData?.phone,
      language: user.userData?.language,
      currency: user.userData?.currency,

      ...(detailed && user.status !== UserStatus.ACTIVE
        ? undefined
        : {
            ref: user.ref,
            refFeePercent: user.refFeePercent,
            refVolume: user.refVolume,
            refCredit: user.refCredit,
            refCount: await this.userRepo.count({ usedRef: user.ref }),
            refCountActive: await this.userRepo.count({ usedRef: user.ref, status: Not(UserStatus.NA) }),
          }),

      kycStatus: user.userData?.kycStatus,
      kycState: user.userData?.kycState,
      kycHash: user.userData?.kycHash,
      depositLimit: user.userData?.depositLimit,
      identDataComplete: this.identService.isDataComplete(user.userData),
    };
  }

  // --- CFP VOTES --- //
  async getCfpVotes(id: number): Promise<CfpVotes> {
    return this.userRepo
      .findOne({ id }, { select: ['id', 'cfpVotes'] })
      .then((u) => (u.cfpVotes ? JSON.parse(u.cfpVotes) : {}));
  }

  async updateCfpVotes(id: number, votes: CfpVotes): Promise<CfpVotes> {
    await this.userRepo.update(id, { cfpVotes: JSON.stringify(votes) });
    return votes;
  }
}
