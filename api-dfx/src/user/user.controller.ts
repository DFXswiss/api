import { Controller, Get, Param } from '@nestjs/common';

@Controller('user')
export class UserController {

@Get()
async getUsers(@Param("address") address:string){
    
}

}