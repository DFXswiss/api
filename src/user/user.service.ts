import { Injectable } from "@nestjs/common";
import { InjectRepository } from '@nestjs/typeorm'
import { CreateUserDto } from "./dto/create-user.dto";
import { User } from './user.entity'
import { UserRepository } from "./user.repository";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(UserRepository)
        private userRepository: UserRepository,
      ) {}
      
    async createUser(createUserDto: CreateUserDto):Promise<any> {
        return this.userRepository.createUser(createUserDto);
    }

    async getUser(user: User): Promise<any> {
        if(user.status == "Active" || user.status == "KYC"){
            return user;
        }else{
            user.ref = -1;
            return user;
        }
    }

    async updateStatus(user: UpdateUserDto): Promise<any> {
        //TODO status ändern wenn transaction oder KYC
        return this.userRepository.updateStatus(user);
    }

    async updateUser(oldUser: User,newUser: UpdateUserDto):Promise<any> {
        return this.userRepository.updateUser(oldUser,newUser);
    }

    async getAllUser():Promise<any>{
        return this.userRepository.getAllUser();
    }

    async verifyUser(user: UpdateUserDto): Promise<any> {
        return this.userRepository.verifyUser(user);
    }

    async updateRole(user: UpdateRoleDto): Promise<any> {
        return this.userRepository.updateRole(user);
    }

}