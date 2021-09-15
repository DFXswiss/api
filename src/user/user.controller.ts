import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetUser } from 'src/auth/get-user.decorator';
import { RoleGuard } from 'src/guards/role.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { User, UserRole } from './user.entity';
import { UserService } from './user.service';
import { UpdateStatusDto } from './dto/update-status.dto';
import { KycService } from 'src/services/kyc.service';
import { UserDataService } from 'src/userData/userData.service';
import { NameCheckStatus, UserData } from 'src/userData/userData.entity';
import { UserDataRepository } from 'src/userData/userData.repository';

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
    private readonly kycService: KycService,
    private readonly userDataRepo: UserDataRepository
  ) {}

  @Get('all/nameCheck')
  async registerAllKyc() {
    const users = await this.userDataRepo.find({where: { nameCheck: NameCheckStatus.NA }, relations: ['bankDatas']});
    return await Promise.all(users.filter((u) => u.bankDatas.length > 0).map((u) => this.doNameCheck(u)));
  }

  private async doNameCheck(userData: UserData): Promise<void> {
    const nameToCheck = userData.bankDatas[0].name;
    userData.kycCustomerId = await this.kycService.createCustomer(userData.id, nameToCheck);
    userData.nameCheck = (await this.kycService.checkCustomer(userData.id))
      ? NameCheckStatus.SAFE
      : NameCheckStatus.WARNING;

    // save
    await this.userDataRepo.save(userData);
  }

  

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getUser(@GetUser() user: User): Promise<any> {
    return this.userService.getUser(user, false);
  }

  @Get('detail')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getUserDetail(@GetUser() user: User): Promise<any> {
    return this.userService.getUser(user, true);
  }

  @Get('ref')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getUserRefData(@GetUser() user: User): Promise<any> {
    return await this.userService.getRefData(user);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateUser(@GetUser() oldUser: User, @Body() newUser: UpdateUserDto): Promise<any> {
    return this.userService.updateUser(oldUser, newUser);
  }

  @Get('all')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllUser(): Promise<any> {
    return this.userService.getAllUser();
  }

  @Put('role')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateRole(@Body() user: UpdateRoleDto): Promise<any> {
    return this.userService.updateRole(user);
  }

  @Put('status')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateStatus(@Body() user: UpdateStatusDto): Promise<any> {
    return this.userService.updateStatus(user);
  }

  @Post('kyc')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async requestKyc(@GetUser() user: User): Promise<UserData> {
    return await this.userDataService.requestKyc(user.id);
  }
}
