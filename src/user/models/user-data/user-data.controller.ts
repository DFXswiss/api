import { BadRequestException, Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UpdateUserDataDto } from './dto/update-user-data.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserDataService } from './user-data.service';
import { UserData } from './user-data.entity';
import { UserDataRepository } from './user-data.repository';
import { BankDataDto } from 'src/user/models/bank-data/dto/bank-data.dto';
import { BankDataService } from 'src/user/models/bank-data/bank-data.service';
import { KycService } from '../kyc/kyc.service';

@ApiTags('userData')
@Controller('userData')
export class UserDataController {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly bankDataService: BankDataService,
    private readonly userDataRepo: UserDataRepository,
    private readonly kycService: KycService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllUserData(): Promise<UserData[]> {
    return this.userDataRepo.find();
  }

  @Get('kycFileId')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllUserDataWithEmptyFileId(): Promise<number[]> {
    return this.userDataService.getAllUserDataWithEmptyFileId();
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateUserData(@Param('id') id: string, @Body() userData: UpdateUserDataDto): Promise<UserData> {
    return this.userDataService.updateUserData(+id, userData);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUserData(@Param('id') id: string): Promise<UserData> {
    return this.userDataRepo.findOne(id);
  }

  @Put(':id/bankDatas')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async addBankData(@Param('id') id: string, @Body() bankData: BankDataDto): Promise<UserData> {
    return this.bankDataService.addBankData(+id, bankData);
  }

  @Put(':id/merge')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async mergeUserData(@Param('id') masterId: string, @Query('id') slaveId: string): Promise<void> {
    return this.userDataService.mergeUserData(+masterId, +slaveId);
  }

  // --- IDENT --- //
  @Put(':id/kyc')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async requestKyc(@Param('id') id: string): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id }, relations: ['users'] });
    const user = userData.users[0];
    if (!user) throw new BadRequestException('User not found');

    return this.kycService.requestKyc(user.id);
  }

  @Get(':id/nameCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getNameCheck(@Param('id') id: string): Promise<string> {
    return this.kycService.doNameCheck(+id);
  }

  @Put(':id/resync')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async resyncKycData(@Param('id') id: string): Promise<void> {
    return this.kycService.resyncKycData(+id);
  }
}
