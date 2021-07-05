import { Injectable } from "@nestjs/common";
import { InjectRepository } from '@nestjs/typeorm'
import { CreateUserDto } from "./dto/create-user.dto";
import { User } from './user.entity'
import { UserRepository } from "./user.repository";

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(UserRepository)
        private userRepository: UserRepository,
      ) {}
      
    async createUser(createUserDto: CreateUserDto):Promise<void>{
        this.userRepository.createUser(createUserDto);
    }

    async getUser(address: string,signature: string):Promise<User>{
        return this.userRepository.findOne({"address": address,"signature":signature});
    } 

    async updateUser(user: any):Promise<string>{
        return "";
    }

    async getAllUsers():Promise<User[]>{
        return this.userRepository.find();
    }

}