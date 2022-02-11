import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { extractUserInfo, getUserInfo, User, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { KycResult, UserDataService } from 'src/user/models/userData/userData.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/util';
import { KycDocument } from 'src/user/services/kyc/dto/kyc.dto';
import { CfpVotes } from './dto/cfp-votes.dto';
import { KycService } from 'src/user/services/kyc/kyc.service';
import { kycInProgress, KycState } from '../userData/userData.entity';
import { UserDataRepository } from '../userData/userData.repository';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataService: UserDataService,
    private readonly userDataRepo: UserDataRepository,
    private readonly countryService: CountryService,
    private readonly languageService: LanguageService,
    private readonly fiatService: FiatService,
    private readonly kycService: KycService,
  ) {}

  async getUser(userId: number, detailedUser = false): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['userData', 'currency'],
    });
    if (!user) throw new NotFoundException('No matching user for id found');

    return await this.toDto(user, detailedUser);
  }

  async updateStatus(userId: number, status: UserStatus): Promise<void> {
    const user = await this.userRepo.findOne({ id: userId });
    if (!user) throw new NotFoundException('No matching user found');

    user.status = status;
    await this.userRepo.save(user);
  }

  async updateUser(oldUserId: number, newUser: UpdateUserDto): Promise<any> {
    const oldUser = await this.userRepo.findOne({ where: { id: oldUserId }, relations: ['userData'] });

    if (newUser.phone != oldUser.phone || newUser.mail != oldUser.mail) {
      await this.kycService.updateCustomer(oldUser.userData.id, {
        telephones: [newUser.phone.replace('+', '').split(' ').join('')],
        emails: [newUser.mail],
      });

      if (kycInProgress(oldUser.userData.kycStatus)) {
        this.userDataRepo.update({ id: oldUser.userData.id }, { kycState: KycState.FAILED });
      }
    }
    const user = await this.userRepo.updateUser(
      oldUser,
      newUser,
      this.languageService,
      this.countryService,
      this.fiatService,
    );
    user.userData = await this.userDataService.updateUserInfo(oldUser.userData, extractUserInfo(user));

    return await this.toDto(user, true);
  }

  private async toDto(user: User, detailed: boolean): Promise<User> {
    // add additional data
    user['kycStatus'] = user.userData?.kycStatus;
    user['kycState'] = user.userData?.kycState;
    user['depositLimit'] = user.userData?.depositLimit;

    if (detailed) {
      user['refData'] = await this.getRefData(user);
    }

    // select user info
    user = { ...user, ...getUserInfo(user) };

    // remove data to hide
    delete user.userData;
    delete user.signature;
    delete user.ip;
    delete user.role;
    delete user.cfpVotes;
    if (user.status != UserStatus.ACTIVE) delete user.ref;
    if (user.usedRef === '000-000') delete user.usedRef;

    return user;
  }

  async getAllUser(): Promise<any> {
    return this.userRepo.getAllUser();
  }

  async verifyUser(userId: number) {
    const { userData } = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['userData', 'userData.country', 'userData.organizationCountry'],
    });

    return this.userDataService.verifyUser(userData);
  }

  async updateRole(user: UpdateRoleDto): Promise<any> {
    return this.userRepo.updateRole(user);
  }

  async requestKyc(userId: number): Promise<KycResult> {
    return this.userDataService.requestKyc(userId);
  }

  async uploadDocument(userId: number, document: Express.Multer.File, kycDocument: KycDocument): Promise<boolean> {
    return this.userDataService.uploadDocument(userId, document, kycDocument);
  }

  async getRefDataForId(userId: number): Promise<any> {
    const user = await this.userRepo.findOne(userId);
    return this.getRefData(user);
  }

  async getRefData(user: User): Promise<any> {
    return {
      ref: user.status == UserStatus.NA ? undefined : user.ref,
      refFee: user.status == UserStatus.NA ? undefined : user.refFeePercent,
      refCount: await this.userRepo.getRefCount(user.ref),
      refCountActive: await this.userRepo.getRefCountActive(user.ref),
    };
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
