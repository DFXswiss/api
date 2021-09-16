import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/guards/role.guard';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/user/user.entity';
import { UserDataService } from './userData.service';
import { NameCheckStatus, UserData } from './userData.entity';
import { UserDataRepository } from './userData.repository';
import { BankDataDto } from 'src/bankData/dto/bankData.dto';
import { BankDataService } from 'src/bankData/bankData.service';

@ApiTags('userData')
@Controller('userData')
export class UserDataController {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly bankDataService: BankDataService,
    private readonly userDataRepo: UserDataRepository,
  ) {}

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUserData(@Param('id') id: number): Promise<UserData> {
    return this.userDataRepo.findOne(id);
  }

  @Get(':name/:location')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUserDataExtends(@Param('name') name: string, @Param('location') location: string): Promise<UserData> {
    return this.userDataService.getUserData(name, location);
  }

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

  @Put(':id/nameCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async doNameCheck(@Param('id') id: number): Promise<NameCheckStatus> {
    return this.userDataService.doNameCheck(id);
  }

  @Put(':id/bankDatas')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async addBankData(@Param('id') id: number, @Body() bankData: BankDataDto): Promise<UserData> {
    return this.bankDataService.addBankData(id, bankData);
  }
}
