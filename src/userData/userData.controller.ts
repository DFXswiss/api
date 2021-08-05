import {
    Body,
    Controller,
    Get,
    Param,
    Put,
    UseGuards,
    Request,
    ForbiddenException,
    Post,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/guards/role.guard';
import { CreateUserDataDto } from './dto/create-userData.dto';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/user/user.entity';
import { UserDataService } from './userData.service';
  
  @ApiTags('userData')
  @Controller('userData')
  export class UserDataController {
    constructor(private readonly userDataService: UserDataService) {}
  
    @Get(':key')
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getWallet(@Param() wallet: any): Promise<any> {
      return this.userDataService.getUser(wallet);
    }
  
    @Get()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getAllUserData(): Promise<any> {
      return this.userDataService.getAllUserData();
    }
  
    @Post()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    createUserData(@Body() createUserDto: CreateUserDataDto): Promise<any> {
      return this.userDataService.createUser(createUserDto);
    }
  
    @Put()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async updateUserData(@Body() userData: UpdateUserDataDto): Promise<any> {
      return this.userDataService.updateUserData(userData);
    }
  }