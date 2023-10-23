import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { CreateBankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/create-bank-data.dto';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { KycService } from '../kyc/kyc.service';
import { UpdateKycStatusDto } from './dto/update-kyc-status.dto';
import { UpdateUserDataDto } from './dto/update-user-data.dto';
import { UserData } from './user-data.entity';
import { UserDataRepository } from './user-data.repository';
import { UserDataService } from './user-data.service';

@ApiTags('userData')
@Controller('userData')
export class UserDataController {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly bankDataService: BankDataService,
    private readonly userDataRepo: UserDataRepository,
    private readonly kycService: KycService,
    private readonly feeService: FeeService,
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
    return this.userDataRepo.findOneBy({ id: +id });
  }

  @Put(':id/bankDatas')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async addBankData(@Param('id') id: string, @Body() bankData: CreateBankDataDto): Promise<UserData> {
    return this.bankDataService.addBankData(+id, bankData);
  }

  @Put(':id/merge')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async mergeUserData(@Param('id') masterId: string, @Query('id') slaveId: string): Promise<void> {
    return this.userDataService.mergeUserData(+masterId, +slaveId);
  }

  @Put(':id/volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateVolumes(@Param('id') id: string): Promise<void> {
    return this.userDataService.updateVolumes(+id);
  }

  // --- DISCOUNT CODES --- //

  @Put(':id/fee')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async addFee(@Param('id') id: string, @Query('fee') feeId: string): Promise<void> {
    const userData = await this.userDataService.getUserData(+id);
    return this.feeService.addFeeInternal(userData, +feeId);
  }

  @Delete(':id/fee')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async removeFee(@Param('id') id: string, @Query('fee') feeId: string): Promise<void> {
    const userData = await this.userDataService.getUserData(+id);
    return this.userDataService.removeFee(userData, +feeId);
  }

  // --- IDENT --- //
  @Put(':id/kyc')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async requestKyc(@Param('id') id: string): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: +id }, relations: ['users'] });

    await this.kycService.requestKyc(userData.kycHash);
    return userData.kycHash;
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

  @Put(':id/kycStatus')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateKycStatus(@Param('id') id: string, @Body() dto: UpdateKycStatusDto): Promise<void> {
    return this.kycService.updateKycStatus(+id, dto);
  }
}
