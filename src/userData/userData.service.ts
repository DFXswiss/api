import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateUserDataDto } from './dto/create-userData.dto';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { UserData } from './userData.entity';

@Injectable()
export class UserDataService {
  constructor(
    @InjectRepository(UserDataRepository)
    private userRepository: UserDataRepository,
  ) {}

  async createUser(createUserDto: CreateUserDataDto): Promise<UserData> {
    return await this.userRepository.createUserData(createUserDto);
  }

  async getUser(key: any): Promise<any> {
    return this.userRepository.getUserData(key);
  }

  async updateUserData(newUser: UpdateUserDataDto): Promise<any> {
    return this.userRepository.updateUserData(newUser);
  }

  async getAllUserData(): Promise<any> {
    return this.userRepository.getAllUserData();
  }
}
