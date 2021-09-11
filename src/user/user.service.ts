import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserRole, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class UserService {
  constructor(private userRepository: UserRepository) {}

  async createUser(createUserDto: CreateUserDto): Promise<User> {
    const user = await this.userRepository.createUser(createUserDto);

    delete user.address;
    delete user.signature;
    delete user.ip;
    delete user.ref;
    delete user.role;
    delete user.status;

    return user;
  }

  async getUser(user: User, detailedUser: boolean): Promise<any> {
    if (detailedUser) {
      const buys = await user.buys;

      if (buys) {
        for (let a = 0; a < buys.length; a++) {
          delete buys[a].user;
        }
      }
      const sells = await user.sells;

      if (sells) {
        for (let a = 0; a < sells.length; a++) {
          delete sells[a].user;
        }
      }

      user.sells = sells;
    }

    user['refData'] = await this.userRepository.getRefData(user);
    //user['has_buy'] = user['__has_buys__'];
    delete user['__has_buys__'];
    user['buy'] = user['__buys__'];
    delete user['__buys__'];

    //user['has_sell'] = user['__has_sells__'];
    delete user['__has_sells__'];
    user['sell'] = user['__sells__'];
    delete user['__sells__'];

    delete user.address;
    delete user.signature;
    delete user.ip;
    if (user.role != UserRole.VIP) delete user.role;
    if (user.status != UserStatus.NA) {
      return user;
    } else {
      delete user.ref;
      return user;
    }
  }

  async updateStatus(user: UpdateStatusDto): Promise<any> {
    //TODO status ändern wenn transaction oder KYC
    return this.userRepository.updateStatus(user);
  }

  async updateUser(oldUser: User, newUser: UpdateUserDto): Promise<any> {
    const user = this.userRepository.updateUser(oldUser, newUser);

    //TODO
    // delete user.signature;
    // delete user.ip;

    // if(user){
    //     if(user.status == "Active" || user.status == "KYC"){
    //         return user;
    //     }else{
    //         delete user.ref;
    //         return user;
    //     }
    // }

    return user;
  }

  async getAllUser(): Promise<any> {
    return this.userRepository.getAllUser();
  }

  async verifyUser(id: number, address: string): Promise<any> {
    return this.userRepository.verifyUser(address);
  }

  async updateRole(user: UpdateRoleDto): Promise<any> {
    return this.userRepository.updateRole(user);
  }

  async getRefData(user: User): Promise<any> {
    return { usedRefData: await this.userRepository.getRefData(user) };
  }
}
