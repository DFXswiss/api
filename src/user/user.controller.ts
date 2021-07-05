import { Body, Controller, Get, Param, Put, UseGuards, Request, ForbiddenException,Post } from '@nestjs/common';
import { ApiTags} from '@nestjs/swagger';
import { UserGuard } from 'src/guards/user.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './user.entity';
import { UserService } from './user.service';

@ApiTags('user')
@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService){}

    @Get()
    @UseGuards(UserGuard)
    async getUser(): Promise<any> {
        return await this.userService.getUser("8FhuD5a5qWYk5mtQnfMP7gF5oTaKMkMQQ1","IMFmkM25tqVtrva3m7xFd+py91i7q/23FJ8bSl7No0VgVcQo4ATV19+XoS+tLlydtS1gj2zl0Zb0XL2GDj/bwho=");
    }
        
    @Post()
    @UseGuards(UserGuard)
    async createUser(@Body() createUserDto: CreateUserDto){
        if (this.userService.getUser("","") != null)
            return "Already exist"
        this.userService.createUser(createUserDto);
    }

    @Put()
    @UseGuards(UserGuard)
    async updateUser(@Body() user: User){
        if (this.userService.getUser("","") == null)
            return "Not exist"
        this.userService.updateUser(user);
    }


}