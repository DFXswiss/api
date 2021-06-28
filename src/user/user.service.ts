import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectEntityManager } from '@nestjs/typeorm'
import { User } from './user.entity'
export class UserService {
   
    async createUser(user: any):Promise<string>{
        return "1";
    }

    async findUserByAddress():Promise<string>{
        return "2";
    } 

    async updateUser(user: any):Promise<string>{
        return "3";
    }
}