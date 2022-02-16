import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserDataService } from 'src/user/models/userData/userData.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/util';
import { CfpVotes } from './dto/cfp-votes.dto';
import { UserDetailDto } from './dto/user.dto';
import { IdentService } from '../ident/ident.service';
import { CreateUserDto } from './dto/create-user.dto';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataService: UserDataService,
    private readonly fiatService: FiatService,
    private readonly identService: IdentService,
    private readonly walletService: WalletService,
  ) {}

  async getAllUser(): Promise<any> {
    return this.userRepo.getAllUser();
  }

  async getUser(userId: number, detailed = false): Promise<UserDetailDto> {
    const user = await this.userRepo.findOne(userId, { relations: ['userData', 'currency'] });
    if (!user) throw new NotFoundException('No matching user for id found');

    return await this.toDto(user, detailed);
  }

  async getUserByAddress(address: string): Promise<User> {
    return this.userRepo.findOne({ address });
  }

  async createUser(dto: CreateUserDto, userIp: string): Promise<User> {
    const user = await this.userRepo.createUser(this.walletService, dto, userIp);
    await this.userDataService.createUserData(user);

    return user;
  }

  async updateStatus(userId: number, status: UserStatus): Promise<void> {
    const user = await this.userRepo.findOne({ id: userId });
    if (!user) throw new NotFoundException('No matching user found');

    user.status = status;
    await this.userRepo.save(user);
  }

  async updateUser(id: number, dto: UpdateUserDto): Promise<UserDetailDto> {
    let user = await this.userRepo.findOne({ where: { id }, relations: ['userData'] });
    if (!user) throw new NotFoundException('No matching user found');

    // update ref
    const refUser = await this.userRepo.findOne({ where: { ref: dto.usedRef }, relations: ['userData'] });
    if (
      user.ref == dto.usedRef ||
      (dto.usedRef && !refUser) ||
      dto.usedRef === null ||
      user.userData.id === refUser?.userData.id
    ) {
      // invalid ref
      dto.usedRef = '000-000';
    }

    // check currency
    if (dto.currency) {
      const currency = await this.fiatService.getFiat(dto.currency.id);
      if (!currency) throw new NotFoundException('No currency for ID found');
    }

    // update
    user = await this.userRepo.save({ ...user, ...dto });
    user.userData = await this.userDataService.updateUserSettings(user.userData, dto);

    return await this.toDto(user, true);
  }

  private async toDto(user: User, detailed: boolean): Promise<UserDetailDto> {
    return {
      accountType: user.userData?.accountType,
      address: user.address,
      status: user.status,
      usedRef: user.usedRef === '000-000' ? undefined : user.usedRef,
      currency: user.currency,
      mail: user.userData?.mail,
      phone: user.userData?.phone,
      language: user.userData?.language,

      ...(detailed && user.status !== UserStatus.ACTIVE
        ? undefined
        : {
            ref: user.ref,
            refFeePercent: user.refFeePercent,
            refVolume: user.refVolume,
            refCredit: user.refCredit,
            refCount: await this.userRepo.getRefCount(user.ref),
            refCountActive: await this.userRepo.getRefCountActive(user.ref),
          }),

      kycStatus: user.userData?.kycStatus,
      kycState: user.userData?.kycState,
      kycHash: user.userData?.kycHash,
      depositLimit: user.userData?.depositLimit,
      identDataComplete: this.identService.isDataComplete(user.userData),
    };
  }

  async updateRole(user: UpdateRoleDto): Promise<any> {
    return this.userRepo.updateRole(user);
  }

  async updateRefFee(userId: number, fee: number): Promise<number> {
    const user = await this.userRepo.findOne(userId);
    if (!user) throw new NotFoundException('No matching user found');

    if (user.refFeePercent < fee) throw new BadRequestException('Ref fee can only be decreased');
    await this.userRepo.update({ id: userId }, { refFeePercent: fee });
    return fee;
  }

  async updateRefVolume(ref: string, volume: number, credit: number): Promise<void> {
    await this.userRepo.update({ ref }, { refVolume: Util.round(volume, 0), refCredit: Util.round(credit, 0) });
  }

  async getRefUser(userId: number): Promise<User | undefined> {
    const { usedRef } = await this.userRepo.findOne({ select: ['id', 'usedRef'], where: { id: userId } });
    return this.userRepo.findOne({ ref: usedRef });
  }

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
