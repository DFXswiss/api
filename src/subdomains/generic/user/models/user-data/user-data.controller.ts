import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/utils/util';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { CreateBankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/create-bank-data.dto';
import { UploadFileDto } from 'src/subdomains/generic/user/models/user-data/dto/upload-file.dto';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { DownloadUserDataDto } from '../user/dto/download-user-data.dto';
import { CreateUserDataDto } from './dto/create-user-data.dto';
import { UpdateUserDataDto } from './dto/update-user-data.dto';
import { UserData, UserDataComplianceUpdateCols, UserDataSupportUpdateCols } from './user-data.entity';
import { UserDataStatus } from './user-data.enum';
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
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getAllUserData(): Promise<UserData[]> {
    return this.userDataRepo.find();
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async updateUserData(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserDataDto,
  ): Promise<UserData> {
    if (jwt.role === UserRole.SUPPORT && Object.keys(dto).some((k) => !UserDataSupportUpdateCols.includes(k)))
      throw new ForbiddenException('Support is not allowed to update this value');

    if (
      jwt.role === UserRole.COMPLIANCE &&
      Object.keys(dto).some((k) => ![...UserDataSupportUpdateCols, ...UserDataComplianceUpdateCols].includes(k))
    )
      throw new ForbiddenException('Compliance is not allowed to update this value');

    return this.userDataService.updateUserData(+id, dto);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getUserData(@Param('id') id: string): Promise<UserData> {
    return this.userDataRepo.findOneBy({ id: +id });
  }

  @Put(':id/bankDatas')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async addBankData(@Param('id') id: string, @Body() bankData: CreateBankDataDto): Promise<UserData> {
    return this.bankDataService.addBankData(+id, bankData);
  }

  @Put(':id/merge')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async mergeUserData(@Param('id') masterId: string, @Query('id') slaveId: string): Promise<void> {
    return this.userDataService.mergeUserData(+masterId, +slaveId, undefined, true);
  }

  @Put(':id/volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateVolumes(@Param('id') id: string): Promise<void> {
    return this.userDataService.updateVolumes(+id);
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async createEmptyUserData(@Body() dto: CreateUserDataDto): Promise<UserData> {
    return this.userDataService.createUserData({ ...dto, status: UserDataStatus.KYC_ONLY });
  }

  // --- DISCOUNT CODES --- //

  @Put(':id/fee')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async addFee(@Param('id') id: string, @Query('fee') feeId: string): Promise<void> {
    const userData = await this.userDataService.getUserData(+id);
    return this.feeService.addFeeInternal(userData, +feeId);
  }

  @Delete(':id/fee')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async removeFee(@Param('id') id: string, @Query('fee') feeId: string): Promise<void> {
    const userData = await this.userDataService.getUserData(+id);
    return this.userDataService.removeFee(userData, +feeId);
  }

  // --- IDENT --- //

  @Post(':id/kycFile')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async uploadKycFile(@Param('id') id: string, @Body() dto: UploadFileDto): Promise<string> {
    const userData = await this.userDataService.getUserData(+id);

    const { url } = await this.documentService.uploadUserFile(
      userData,
      dto.documentType,
      dto.originalName,
      Buffer.from(dto.data, 'base64'),
      dto.contentType,
      true,
      undefined,
      dto.documentSubType,
      {
        document: dto.documentType.toString(),
        creationTime: new Date().toISOString(),
        fileName: dto.originalName,
      },
    );

    if (dto.kycLogId != null) await this.kycLogService.updateLogPdfUrl(dto.kycLogId, url);

    return url;
  }

  @Post('download')
  @ApiBearerAuth()
  @ApiOkResponse({ type: StreamableFile })
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async downloadUserData(@Body() data: DownloadUserDataDto, @Res({ passthrough: true }) res): Promise<StreamableFile> {
    const zipContent = await this.userDataService.downloadUserData(data.userDataIds);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="DFX_export_${Util.filenameDate()}.zip"`,
    });

    return new StreamableFile(zipContent);
  }
}
