import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserRole } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CountryRepository } from 'src/country/country.repository';
import { getManager } from 'typeorm';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserRepository)
    private userRepository: UserRepository,
  ) {}

  async createUser(createUserDto: CreateUserDto): Promise<any> {
    const user = this.userRepository.createUser(createUserDto);

    delete user['address'];
    delete user['signature'];
    delete user['ip'];
    delete user['ref'];
    delete user['role'];
    delete user['status'];

    return user;
  }

  async getUser(user: User): Promise<any> {

    user.country = await getManager()
    .getCustomRepository(CountryRepository)
    .getCountry(user.country);

    delete user['address'];
    delete user['signature'];
    delete user['ip'];
    if (user.role != UserRole.VIP) delete user['role'];
    if (user.status == 'Active' || user.status == 'KYC') {
      return user;
    } else {
      delete user['ref'];
      return user;
    }
  }

  async updateStatus(user: UpdateUserDto): Promise<any> {
    //TODO status ändern wenn transaction oder KYC
    return this.userRepository.updateStatus(user);
  }

  async updateUser(oldUser: User, newUser: UpdateUserDto): Promise<any> {
    const user = this.userRepository.updateUser(oldUser, newUser);

    //TODO
    // delete user["signature"];
    // delete user["ip"];

    // if(user){
    //     if(user.status == "Active" || user.status == "KYC"){
    //         return user;
    //     }else{
    //         delete user["ref"];
    //         return user;
    //     }
    // }

    return user;
  }

  async getAllUser(): Promise<any> {
    return this.userRepository.getAllUser();
  }

  async verifyUser(id: number, address:string ): Promise<any> {
    return this.userRepository.verifyUser(address);
  }

  async updateRole(user: UpdateRoleDto): Promise<any> {
    return this.userRepository.updateRole(user);
  }
}
