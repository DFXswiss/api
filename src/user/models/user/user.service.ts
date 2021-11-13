import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UserDataService } from 'src/user/models/userData/userData.service';
import { LogDirection } from 'src/user/models/log/log.entity';
import { LogService } from 'src/user/models/log/log.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/util';

@Injectable()
export class UserService {
  constructor(
    private userRepo: UserRepository,
    private userDataService: UserDataService,
    private logService: LogService,
    private countryService: CountryService,
    private languageService: LanguageService,
    private fiatService: FiatService,
    private assetService: AssetService,
  ) {}

  async createUser(createUserDto: CreateUserDto): Promise<User> {
    const user = await this.userRepo.createUser(
      createUserDto,
      this.languageService,
      this.countryService,
      this.fiatService,
      this.assetService,
    );

    delete user.signature;
    delete user.ip;
    delete user.ref;
    delete user.role;
    delete user.status;

    return user;
  }

  async getUser(userId: number, detailedUser = false): Promise<User> {
    const currentUser = await this.userRepo.findOne({
      where: { id: userId },
      relations: detailedUser
        ? ['userData', 'buys', 'sells', 'currency', 'refFeeAsset']
        : ['userData', 'currency', 'refFeeAsset'],
    });

    if (!currentUser) throw new NotFoundException('No matching user for id found');
    if (!currentUser.currency) currentUser.currency = await this.fiatService.getFiat('eur'); // TODO: add as default values on create?
    if (!currentUser.refFeeAsset) currentUser.refFeeAsset = await this.assetService.getAsset('dBTC');
    currentUser['kycStatus'] = currentUser.userData.kycStatus;
    currentUser['depositLimit'] = currentUser.userData.depositLimit;

    if (detailedUser) {
      currentUser['refData'] = await this.getRefData(currentUser);
      currentUser['userVolume'] = await this.getUserVolume(currentUser);
    }

    delete currentUser.userData;
    delete currentUser.signature;
    delete currentUser.ip;
    if (currentUser.role != UserRole.VIP) delete currentUser.role;

    // delete ref for inactive users
    if (currentUser.status == UserStatus.NA) delete currentUser.ref;

    return currentUser;
  }

  async updateStatus(user: UpdateStatusDto): Promise<any> {
    //TODO status ändern wenn transaction oder KYC
    return this.userRepo.updateStatus(user);
  }

  async updateUser(oldUserId: number, newUser: UpdateUserDto): Promise<any> {
    const oldUser = await this.userRepo.findOne(oldUserId);
    const user = await this.userRepo.updateUser(
      oldUser,
      newUser,
      this.languageService,
      this.countryService,
      this.fiatService,
      this.assetService,
    );

    user['refData'] = await this.getRefData(user);
    user['userVolume'] = await this.getUserVolume(user);

    const userData = (await this.userRepo.findOne({ where: { id: user.id }, relations: ['userData'] })).userData;
    user['kycStatus'] = userData.kycStatus;
    user['kycState'] = userData.kycState;
    delete user.userData;
    // delete ref for inactive users
    if (user.status == UserStatus.NA) {
      delete user.ref;
    }

    delete user.signature;
    delete user.ip;
    if (user.role != UserRole.VIP) delete user.role;

    return user;
  }

  async getAllUser(): Promise<any> {
    return this.userRepo.getAllUser();
  }

  async verifyUser(id: number): Promise<{ result: boolean; errors: { [error: string]: string } }> {
    const currentUser = await this.userRepo.findOne(id);
    if (!currentUser) throw new NotFoundException('No matching user for id found');

    const requiredFields = [
      'mail',
      'firstname',
      'surname',
      'street',
      'houseNumber',
      'location',
      'zip',
      'country',
      'phone',
    ];
    const errors = requiredFields.filter((f) => !currentUser[f]);

    return {
      result: errors.length === 0,
      errors: errors.reduce((prev, curr) => ({ ...prev, [curr]: 'missing' }), {}),
    };
  }

  async updateRole(user: UpdateRoleDto): Promise<any> {
    return this.userRepo.updateRole(user);
  }

  async requestKyc(userId: number, depositLimit: string): Promise<boolean> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['userData'] });
    const userData = user.userData;

    return this.userDataService.requestKyc(userData.id, depositLimit);
  }

  async getUserVolume(user: User): Promise<any> {
    return {
      buyVolume: await this.logService.getUserVolume(user, LogDirection.fiat2asset),
      sellVolume: await this.logService.getUserVolume(user, LogDirection.asset2fiat),
    };
  }

  async getRefDataForId(userId: number): Promise<any> {
    const user = await this.userRepo.findOne(userId);
    return this.getRefData(user);
  }

  async getRefData(user: User): Promise<any> {
    return {
      ref: user.status == UserStatus.NA ? undefined : user.ref,
      refCount: await this.userRepo.getRefCount(user.ref),
      refCountActive: await this.userRepo.getRefCountActive(user.ref),
      refVolumeBtc: await this.logService.getRefVolumeBtc(user.ref),
      refVolume: await this.logService.getRefVolume(user.ref, user.currency?.name.toLowerCase()),
    };
  }

  async getRaw(): Promise<any> {
    const users = await this.userRepo.createQueryBuilder('user').getRawMany();
    return users.map((u) => Util.replaceInKeys(u, 'user_', ''));
  }
}
