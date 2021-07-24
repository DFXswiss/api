import { Body, Controller, Get, Param, Put, UseGuards, Request, ForbiddenException,Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags} from '@nestjs/swagger';
import { GetUser } from 'src/auth/get-user.decorator';
import { RoleGuard } from 'src/guards/role.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { User, UserRole } from './user.entity';
import { UserService } from './user.service';

@ApiTags('user')
@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService){}

    @Get()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
    async getUser(@GetUser() user: User): Promise<any> {
        return this.userService.getUser(user);
    }

    @Put()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
    async updateUser(@GetUser() oldUser: User,@Body() newUser: UpdateUserDto): Promise<any> {
        newUser.address = oldUser.address;
        newUser.signature = oldUser.signature;
        return this.userService.updateUser(oldUser,newUser);
    }

    @Get('all')
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getAllUser(): Promise<any> {
        return this.userService.getAllUser();
    }

    @Put('role')
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async updateRole(@Body() user: UpdateRoleDto): Promise<any> {
        return this.userService.updateRole(user);
    }
}