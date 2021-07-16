import { Body, Controller, Get, Param, Put, UseGuards, Request, ForbiddenException,Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags} from '@nestjs/swagger';
import { GetUser } from 'src/auth/get-user.decorator';
import { UserGuard } from 'src/guards/user.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './user.entity';
import { UserService } from './user.service';

@ApiTags('user')
@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService){}

    @Get()
    @UseGuards(AuthGuard())
    async getUser(@GetUser() user: User): Promise<any> {
        return user;
    }
        
    @Put()
    @UseGuards(AuthGuard())
    async updateUser(@GetUser() user: User){
        this.userService.updateUser(user);
    }

}