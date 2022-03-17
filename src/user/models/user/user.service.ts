import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
import { AccountType } from '../user-data/account-type.enum';
import { CfpSettings } from 'src/statistic/cfp.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfiTaxService } from 'src/shared/services/dfi-tax.service';
import { Config } from 'src/config/config';
import { ApiAuth } from './dto/api-auth.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataService: UserDataService,
    private readonly identService: IdentService,
    private readonly walletService: WalletService,
    private readonly settingService: SettingService,
    private readonly dfiTaxService: DfiTaxService,
  ) {}

  async getAllUser(): Promise<User[]> {
    return await this.userRepo.find();
  }

  async getUser(userId: number): Promise<User> {
    return await this.userRepo.findOne(userId);
  }

  async getUserDto(userId: number, detailed = false): Promise<UserDetailDto> {
    const user = await this.userRepo.findOne(userId, { relations: ['userData'] });
    if (!user) throw new NotFoundException('User not found');

    return await this.toDto(user, detailed);
  }

  async getUserByAddress(address: string): Promise<User> {
    return this.userRepo.findOne({ address });
  }

  async createUser(dto: CreateUserDto, userIp: string, userOrigin?: string): Promise<User> {
    let user = this.userRepo.create(dto);

    user.wallet = await this.walletService.getWalletOrDefault(dto.walletId);
    user.ip = userIp;
    user.ref = await this.getNextRef();
    user.usedRef = await this.checkRef(user, dto.usedRef);
    user.origin = userOrigin;

    user = await this.userRepo.save(user);
    await this.userDataService.createUserData(user);

    this.dfiTaxService.activateAddress(user.address);

    return user;
  }

  async updateUser(id: number, dto: UpdateUserDto): Promise<UserDetailDto> {
    let user = await this.userRepo.findOne({ where: { id }, relations: ['userData'] });
    if (!user) throw new NotFoundException('User not found');

    // check used ref
    dto.usedRef = await this.checkRef(user, dto.usedRef);

    // check ref provision
    if (user.refFeePercent < dto.refFeePercent) throw new BadRequestException('Ref provision can only be decreased');

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

  async getUserBuyFee(userId: number, annualVolume: number): Promise<{ fee: number; refBonus: number }> {
    const { usedRef, accountType, buyFee } = await this.userRepo.findOne({
      select: ['id', 'usedRef', 'accountType', 'buyFee'],
      where: { id: userId },
    });

    if (buyFee != null) return { fee: buyFee * 100, refBonus: 0 };

    const baseFee =
      accountType === AccountType.PERSONAL
        ? // personal
          annualVolume < 5000
          ? Config.buy.fee.private.base
          : annualVolume < 50000
          ? Config.buy.fee.private.moreThan5k
          : annualVolume < 100000
          ? Config.buy.fee.private.moreThan50k
          : Config.buy.fee.private.moreThan100k
        : // organization
          Config.buy.fee.organization;

    const refFee = await this.userRepo
      .findOne({ select: ['id', 'ref', 'refFeePercent'], where: { ref: usedRef } })
      .then((u) => u?.refFeePercent);

    const refBonus = 1 - (refFee ?? 1);

    return { fee: Util.round(baseFee - refBonus, 2), refBonus: Util.round(refBonus, 2) };
  }

  async getUserSellFee(userId: number): Promise<number> {
    const user = await this.userRepo.findOne({
      select: ['id', 'sellFee'],
      where: { id: userId },
    });

    return Util.round((user?.sellFee ?? Config.sell.fee) * 100, 2);
  }

  async getUserStakingFee(userId: number): Promise<number> {
    const user = await this.userRepo.findOne({
      select: ['id', 'stakingFee', 'stakingStart'],
      where: { id: userId },
    });

    const hasFreeStaking = Util.daysDiff(user.stakingStart ?? new Date(), new Date()) < Config.staking.freeDays;

    return Util.round((user?.stakingFee ?? (hasFreeStaking ? 0 : Config.staking.fee)) * 100, 2);
  }

  async updateRefVolume(ref: string, volume: number, credit: number): Promise<void> {
    await this.userRepo.update({ ref }, { refVolume: Util.round(volume, 0), refCredit: Util.round(credit, 0) });
  }

  async updatePaidRefCredit(id: number, volume: number): Promise<void> {
    await this.userRepo.update(id, { paidRefCredit: Util.round(volume, 0) });
  }

  async activateStaking(id: number): Promise<void> {
    await this.userRepo.update(id, { stakingStart: new Date() });
  }

  async createApiData(userId: number, userAddress: string): Promise<ApiAuth> {
    const user = await this.userRepo.findOne({ id: userId });
    if (user.apiKey) throw new ConflictException('Already existing API-Key');

    const apiKey = Util.createHash(Util.createHash(userAddress + new Date().toISOString(), 'sha256'), 'md5');
    await this.userRepo.update(userId, { apiKey: apiKey });
    const apiSecret = await this.getApiSecretInternal(userId);

    return { apiKey: apiKey, apiSecret: apiSecret };
  }

  async deleteApiKey(userId: number): Promise<void> {
    await this.userRepo.update(userId, { apiKey: null });
  }

  async getApiSecretInternal(userId: number): Promise<string> {
    const user = await this.userRepo.findOne({ id: userId });
    return Util.createHash(user.apiKey + user.created, 'sha256');
  }

  async checkApiSecret(apiData: ApiAuth, timestamp: string): Promise<boolean> {
    const user = await this.userRepo.findOne({ apiKey: apiData.apiKey });
    return apiData.apiSecret === Util.createHash((await this.getApiSecretInternal(user.id)) + timestamp, 'sha256');
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

  public async getTotalRefRewards(): Promise<number> {
    return await this.userRepo
      .createQueryBuilder('user')
      .select('SUM(paidRefCredit)', 'paidRefCredit')
      .getRawOne<{ paidRefCredit: number }>()
      .then((r) => r.paidRefCredit);
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
            paidRefCredit: user.paidRefCredit,
            refCount: await this.userRepo.count({ usedRef: user.ref }),
            refCountActive: await this.userRepo.count({ usedRef: user.ref, status: Not(UserStatus.NA) }),
          }),

      kycStatus: user.userData?.kycStatus,
      kycState: user.userData?.kycState,
      kycHash: user.userData?.kycHash,
      depositLimit: user.userData?.depositLimit,
      identDataComplete: this.identService.isDataComplete(user.userData),
      apiKey: user.apiKey,
    };
  }

  // --- CFP VOTES --- //
  async getCfpVotes(id: number): Promise<CfpVotes> {
    return this.userRepo
      .findOne({ id }, { select: ['id', 'cfpVotes'] })
      .then((u) => (u.cfpVotes ? JSON.parse(u.cfpVotes) : {}));
  }

  async updateCfpVotes(id: number, votes: CfpVotes): Promise<CfpVotes> {
    const isVotingOpen = await this.settingService.getObj<CfpSettings>('cfp').then((s) => s.votingOpen);
    if (!isVotingOpen) throw new BadRequestException('Voting is currently not allowed');

    await this.userRepo.update(id, { cfpVotes: JSON.stringify(votes) });
    return votes;
  }
}
