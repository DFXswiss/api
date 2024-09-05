import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { CreateBankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/create-bank-data.dto';
import { UploadFileDto } from 'src/subdomains/generic/user/models/user-data/dto/upload-file.dto';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { CreateUserDataDto } from './dto/create-user-data.dto';
import { UpdateUserDataDto } from './dto/update-user-data.dto';
import { UserData, UserDataStatus } from './user-data.entity';
import { UserDataRepository } from './user-data.repository';
import { UserDataService } from './user-data.service';

@ApiTags('userData')
@Controller('userData')
export class UserDataController {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly bankDataService: BankDataService,
    private readonly userDataRepo: UserDataRepository,
    private readonly feeService: FeeService,
    private readonly documentService: KycDocumentService,
    private readonly kycLogService: KycLogService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllUserData(): Promise<UserData[]> {
    return this.userDataRepo.find();
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
    return this.userDataService.mergeUserData(+masterId, +slaveId, true);
  }

  @Put(':id/volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateVolumes(@Param('id') id: string): Promise<void> {
    return this.userDataService.updateVolumes(+id);
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async createEmptyUserData(@Body() dto: CreateUserDataDto): Promise<UserData> {
    return this.userDataService.createUserData({ ...dto, status: UserDataStatus.KYC_ONLY });
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

  @Post(':id/kycFile')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async uploadKycFile(@Param('id') id: string, @Body() dto: UploadFileDto): Promise<string> {
    const url = await this.documentService.uploadFile(
      +id,
      dto.documentType,
      dto.originalName,
      Buffer.from(dto.data, 'base64'),
      dto.contentType,
      {
        document: dto.documentType.toString(),
        creationTime: new Date().toISOString(),
        fileName: dto.originalName,
      },
    );

    if (dto.kycLogId != null) await this.kycLogService.updateLogPdfUrl(dto.kycLogId, url);

    return url;
  }
}
