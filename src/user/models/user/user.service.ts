import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { extractUserInfo, getUserInfo, User, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UserDataService } from 'src/user/models/userData/userData.service';
import { LogService } from 'src/user/models/log/log.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/util';
import { Config } from 'src/config/config';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataService: UserDataService,
    private readonly logService: LogService,
    private readonly countryService: CountryService,
    private readonly languageService: LanguageService,
    private readonly fiatService: FiatService,
  ) {}

  async getUser(userId: number, detailedUser = false): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['userData', 'currency'],
    });
    if (!user) throw new NotFoundException('No matching user for id found');

    return await this.toDto(user, detailedUser);
  }

  async updateStatus(user: UpdateStatusDto): Promise<any> {
    //TODO status ändern wenn transaction oder KYC
    return this.userRepo.updateStatus(user);
  }

  async updateUser(oldUserId: number, newUser: UpdateUserDto): Promise<any> {
    const oldUser = await this.userRepo.findOne({ where: { id: oldUserId }, relations: ['userData'] });
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

  async requestKyc(userId: number, depositLimit: string): Promise<string | undefined> {
    return this.userDataService.requestKyc(userId, depositLimit);
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
      refVolume: await this.logService.getRefVolume(
        user.ref,
        (user.currency?.name ?? Config.defaultCurrency).toLowerCase(),
      ),
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
    const { usedRef } = await this.userRepo
      .createQueryBuilder('user')
      .select('user.usedRef', 'usedRef')
      .where('user.id = :userId', { userId })
      .getRawOne<{ usedRef: string }>();
    return this.userRepo.findOne({ ref: usedRef });
  }
}
