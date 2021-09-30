import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserRole, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { LogRepository } from 'src/log/log.repository';
import { KycStatus } from 'src/userData/userData.entity';
import { KycService } from 'src/services/kyc.service';
import { UserDataRepository } from 'src/userData/userData.repository';

@Injectable()
export class UserService {
  constructor(
    private userRepo: UserRepository,
    private logRepo: LogRepository,
    private kycService: KycService,
    private userDataRepo: UserDataRepository,
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

  async getUser(user: User, detailedUser: boolean): Promise<any> {
    const currentUser = await this.userRepo.findOne({
      where: { id: user.id },
      relations: ['userData', 'buys', 'sells'],
    });
    user['kycStatus'] = currentUser.userData.kycStatus;

    if (detailedUser) {
      const buys = currentUser.buys;

      if (buys) {
        for (let a = 0; a < buys.length; a++) {
          delete buys[a].user;
        }
      }
      const sells = currentUser.sells;

      if (sells) {
        for (let a = 0; a < sells.length; a++) {
          delete sells[a].user;
        }
      }

      user.buys = buys;
      user.sells = sells;
    }

    user['refData'] = await this.getRefData(user);
    user['userVolume'] = await this.logRepo.getVolume(user);

    delete user.signature;
    delete user.ip;
    if (user.role != UserRole.VIP) delete user.role;

    // delete ref for inactive users
    if (user.status == UserStatus.NA) {
      delete user.ref;
    }

    return user;
  }

  async updateStatus(user: UpdateStatusDto): Promise<any> {
    //TODO status ändern wenn transaction oder KYC
    return this.userRepo.updateStatus(user);
  }

  async updateUser(oldUser: User, newUser: UpdateUserDto): Promise<any> {
    const user = await this.userRepo.updateUser(oldUser, newUser);

    user['refData'] = await this.getRefData(user);
    user['userVolume'] = await this.logRepo.getVolume(user);

    const userData = (await this.userRepo.findOne({ where: { id: user.id }, relations: ['userData'] })).userData;
    user['kycStatus'] = userData.kycStatus;

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

    if (userData?.kycStatus === KycStatus.NA) {
      // update customer
      const customer = await this.kycService.updateCustomer(userData.id, user);
      userData.kycCustomerId = customer.customerId;
      userData.kycFileReference = await this.userDataRepo.getNextKycFileId();
      //await this.kycService.createFileReference(userData.id, userData.kycFileReference, user.surname);
      
      // start onboarding
      const chatBotData = await this.kycService.initiateOnboardingChatBot(userData.id);

      if (chatBotData) userData.kycStatus = KycStatus.WAIT_CHAT_BOT;
      await this.userDataRepo.save(userData);
    }
    return true;
  }

  async getRefData(user: User): Promise<any> {
    const result = {
      ref: user.status == UserStatus.NA ? undefined : user.ref,
      refCount: await this.userRepo.getRefCount(user.ref),
      refCountActive: await this.userRepo.getRefCountActive(user.ref),
      refVolume: await this.logRepo.getRefVolume(user.ref),
    };

    return result;
  }
}
