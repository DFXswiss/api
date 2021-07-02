import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm';
import { User } from './user.entity'

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(User)
        private usersRepository: Repository<User>,
      ) {}
      
    async createUser(user: any):Promise<string>{
        return "1";
    }

    async getUser(address: string,signature: string):Promise<User>{
        return this.usersRepository.findOne({"address": address,"signature":signature});
    } 

    async updateUser(user: any):Promise<string>{
        return "";
    }

    async getAllUsers():Promise<User[]>{
        return this.usersRepository.find();
    }

}