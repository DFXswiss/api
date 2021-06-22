import { Body, Controller, Get, Param, Put, UseGuards, Request, ForbiddenException,Post } from '@nestjs/common';
import { ApiTags} from '@nestjs/swagger';
import { UserGuard } from 'src/auth/user.guard';
import { User } from './user.entity';
import { UserService } from './user.service';

@ApiTags('user')
@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService){}

    @Get()
    @UseGuards(UserGuard)
    async getUser(): Promise<any> {
        return this.userService.findUserByAddress();
    }
        
    @Post()
    @UseGuards(UserGuard)
    async createUser(@Body() user: User, @Request() req){
        if (this.userService.findUserByAddress() != null)
            return "Already exist"
        this.userService.createUser(user);
    }

    @Put()
    @UseGuards(UserGuard)
    async updateUser(@Body() user: User, @Request() req){
        if (this.userService.findUserByAddress() == null)
            return "Not exist"
        this.userService.updateUser(user);
    }


}