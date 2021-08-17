import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserRole } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CountryRepository } from 'src/country/country.repository';
import { getManager } from 'typeorm';
import { UpdateStatusDto } from './dto/update-status.dto';
import { LanguageRepository } from 'src/language/language.repository';
import { BuyRepository } from 'src/buy/buy.repository';
import { SellRepository } from 'src/sell/sell.repository';
import { FiatRepository } from 'src/fiat/fiat.repository';
import { AssetRepository } from 'src/asset/asset.repository';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserRepository)
    private userRepository: UserRepository,
  ) {}

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

    if(detailedUser){

      if (user.buys) {
        for (let a = 0; a < user.buys.length; a++) {
          delete user.buys[a].user;
        }
      }

      if (user.sells) {
        for (let a = 0; a < user.sells.length; a++) {
          delete user.sells[a].user;
        }
      }
    
    }else{
      delete user.buys;
      delete user.sells;
    }

    delete user.address;
    delete user.signature;
    delete user.ip;
    if (user.role != UserRole.VIP) delete user.role;
    if (user.status == 'Active' || user.status == 'KYC') {
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
}
