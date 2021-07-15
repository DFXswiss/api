import { Body, Controller, Get, Param, Put, UseGuards, Request, ForbiddenException,Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags} from '@nestjs/swagger';
import { GetUser } from 'src/auth/get-user.decorator';
import { AdminGuard } from 'src/guards/admin.guard';
import { UserGuard } from 'src/guards/user.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { User } from './user.entity';
import { UserService } from './user.service';

@ApiTags('user')
@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService){}

    @Get()
    @UseGuards(AuthGuard())
    async getUser(@GetUser() user: User): Promise<any> {
        return this.userService.getUser(user);
    }

    @Get('all')
    @UseGuards(AdminGuard)
    async getAllUser(): Promise<any> {
        return this.userService.getAllUser();
    }
        
    @Put()
    async updateUser(@Body() user: UpdateUserDto): Promise<any> {
        return this.userService.updateUser(user);
    }

    @Put('role')
    @UseGuards(AdminGuard)
    async updateRole(@Body() user: UpdateRoleDto): Promise<any> {
        return this.userService.updateRole(user);
    }
}