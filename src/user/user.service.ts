import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserRole, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { LogRepository } from 'src/log/log.repository';
import { KycStatus, UserData } from 'src/userData/userData.entity';
import { KycService } from 'src/services/kyc.service';
import { UserDataService } from 'src/userData/userData.service';
import { LogDirection } from 'src/log/log.entity';
import { ConversionService } from 'src/services/conversion.service';

@Injectable()
export class UserService {
  constructor(
    private userRepo: UserRepository,
    private logRepo: LogRepository,
    private userDataService: UserDataService,
    private conversionService: ConversionService,
  ) {}

  async createUser(createUserDto: CreateUserDto): Promise<User> {
    const user = await this.userRepo.createUser(createUserDto);

    delete user.signature;
    delete user.ip;
    delete user.ref;
    delete user.role;
    delete user.status;

    return user;
  }

  async getUser(userId: number, detailedUser: boolean): Promise<any> {
    const currentUser = await this.userRepo.findOne({
      where: { id: userId },
      relations: detailedUser ? ['userData', 'buys', 'sells'] : ['userData'],
    });

    currentUser['kycStatus'] = currentUser.userData.kycStatus;
    currentUser['refData'] = await this.getRefData(currentUser);
    currentUser['userVolume'] = await this.getUserVolume(currentUser);
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

  async updateUser(oldUser: User, newUser: UpdateUserDto): Promise<any> {
    const user = await this.userRepo.updateUser(oldUser, newUser);

    user['refData'] = await this.getRefData(user);
    user['userVolume'] = await this.getUserVolume(user);

    const userData = (await this.userRepo.findOne({ where: { id: user.id }, relations: ['userData'] })).userData;
    user['kycStatus'] = userData.kycStatus;
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

  async verifyUser(address: string): Promise<any> {
    return this.userRepo.verifyUser(address);
  }

  async updateRole(user: UpdateRoleDto): Promise<any> {
    return this.userRepo.updateRole(user);
  }

  async requestKyc(userId: number): Promise<boolean> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['userData'] });
    const userData = user.userData;

    return this.userDataService.requestKyc(userData.id);
  }

  async getUserVolume(user: User): Promise<any> {
    return {
      buy: await this.conversionService.convertFiatCurrency(
        await this.logRepo.getUserVolume(user, LogDirection.asset2fiat),
        'chf',
        'eur',
        new Date(),
      ),

      sell: await this.conversionService.convertFiatCurrency(
        await this.logRepo.getUserVolume(user, LogDirection.fiat2asset),
        'chf',
        'eur',
        new Date(),
      ),
    };
  }

  async getRefData(user: User): Promise<any> {
    return {
      ref: user.status == UserStatus.NA ? undefined : user.ref,
      refCount: await this.userRepo.getRefCount(user.ref),
      refCountActive: await this.userRepo.getRefCountActive(user.ref),
      refVolume: await this.conversionService.convertFiatCurrency(
        await this.logRepo.getRefVolume(user.ref),
        'chf',
        'eur',
        new Date(),
      ),
    };
  }
}
