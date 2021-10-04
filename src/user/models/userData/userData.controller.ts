import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CustomerDataDetailed, UserDataChecks, UserDataService } from './userData.service';
import { UserData } from './userData.entity';
import { UserDataRepository } from './userData.repository';
import { BankDataDto } from 'src/user/models/bankData/dto/bankData.dto';
import { BankDataService } from 'src/user/models/bankData/bankData.service';

@ApiTags('userData')
@Controller('userData')
export class UserDataController {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly bankDataService: BankDataService,
    private readonly userDataRepo: UserDataRepository,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllUserData(): Promise<any> {
    return this.userDataService.getAllUserData();
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateUserData(@Body() userData: UpdateUserDataDto): Promise<any> {
    return this.userDataService.updateUserData(userData);
  }

  @Get('nameCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  getNameChecks(
    @Query('startUserId') startUserId: number,
    @Query('endUserId') endUserId: number,
  ): Promise<UserDataChecks[]> {
    return this.userDataService.getManyCheckStatus(startUserId, endUserId);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUserData(@Param('id') id: number): Promise<UserData> {
    return this.userDataRepo.findOne(id);
  }

  @Put(':id/kyc')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async requestKyc(@Param('id') id: number): Promise<boolean> {
    return this.userDataService.requestKyc(id);
  }

  @Get(':id/customer')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getCustomer(@Param('id') id: number): Promise<CustomerDataDetailed> {
    return this.userDataService.getCustomer(id);
  }

  @Put(':id/nameCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async doNameCheck(@Param('id') id: number): Promise<string> {
    return this.userDataService.doNameCheck(id);
  }

  @Get(':id/nameCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getNameCheck(@Param('id') id: number): Promise<string> {
    return this.userDataService.getCheckStatus(id);
  }

  @Put(':id/bankDatas')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async addBankData(@Param('id') id: number, @Body() bankData: BankDataDto): Promise<UserData> {
    return this.bankDataService.addBankData(id, bankData);
  }

  @Get(':name/:location')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUserDataExtends(@Param('name') name: string, @Param('location') location: string): Promise<UserData> {
    return this.userDataService.getUserData(name, location);
  }

  @Put(':id/merge')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async mergeUserData(@Param('id') masterId: number, @Query('id') slaveId: number): Promise<void> {
    return this.userDataService.mergeUserData(masterId, slaveId);
  }
}
