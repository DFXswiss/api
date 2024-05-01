import { Body, Controller, Get, Param, Post, Put, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CountryDtoMapper } from 'src/shared/models/country/dto/country-dto.mapper';
import { CountryDto } from 'src/shared/models/country/dto/country.dto';
import { FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { LimitRequestDto } from '../../../kyc/dto/input/limit-request.dto';
import { LimitRequestService } from '../../../kyc/services/limit-request.service';
import { KycDataTransferDto } from './dto/kyc-data-transfer.dto';
import { KycDataDto } from './dto/kyc-data.dto';
import { KycDocumentType, KycFileDto } from './dto/kyc-file.dto';
import { KycInfo } from './dto/kyc-info.dto';
import { KycUserDataDto } from './dto/kyc-user-data.dto';
import { KycService } from './kyc.service';

@ApiTags('KYC')
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService, private readonly limitRequestService: LimitRequestService) {}

  // --- TRANSFER --- //
  @Put('transfer')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  @ApiOperation({ deprecated: true })
  async transferKycData(@GetJwt() jwt: JwtPayload, @Body() data: KycDataTransferDto): Promise<void> {
    await this.kycService.transferKycData(jwt.id, data);
  }

  // --- JWT Calls --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async getKycProgress(@GetJwt() jwt: JwtPayload): Promise<KycInfo> {
    return this.kycService.getKycInfo('', jwt.account);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiCreatedResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async requestKyc(@GetJwt() jwt: JwtPayload): Promise<KycInfo> {
    return this.kycService.requestKyc('', jwt.account);
  }

  @Get('countries')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: CountryDto, isArray: true })
  @ApiOperation({ deprecated: true })
  async getKycCountries(@GetJwt() jwt: JwtPayload): Promise<CountryDto[]> {
    return this.kycService.getKycCountries('', jwt.account).then(CountryDtoMapper.entitiesToDto);
  }

  @Post('limit')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse()
  @ApiOperation({ deprecated: true })
  async increaseLimit(@GetJwt() jwt: JwtPayload, @Body() request: LimitRequestDto): Promise<void> {
    return this.limitRequestService.increaseLimit(request, '', jwt.account);
  }

  @Post('data')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiCreatedResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async updateKycData(@GetJwt() jwt: JwtPayload, @Body() data: KycUserDataDto): Promise<KycInfo> {
    return this.kycService.updateKycData('', data, jwt.account);
  }

  @Post('incorporationCertificate')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @UseInterceptors(FilesInterceptor('files'))
  @ApiCreatedResponse({ type: Boolean })
  @ApiOperation({ deprecated: true })
  async uploadIncorporationCertificate(
    @GetJwt() jwt: JwtPayload,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    return this.kycService.uploadDocument('', files[0], FileType.USER_NOTES, jwt.account);
  }

  // --- CODE CALLS --- //
  @Get(':code')
  @ApiOkResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async getKycProgressByCode(@Param('code') code: string): Promise<KycInfo> {
    return this.kycService.getKycInfo(code);
  }

  @Post(':code')
  @ApiCreatedResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async requestKycByCode(@Param('code') code: string): Promise<KycInfo> {
    return this.kycService.requestKyc(code);
  }

  @Get(':code/countries')
  @ApiOkResponse({ type: CountryDto, isArray: true })
  @ApiOperation({ deprecated: true })
  async getKycCountriesByCode(@Param('code') code: string): Promise<CountryDto[]> {
    return this.kycService.getKycCountries(code).then(CountryDtoMapper.entitiesToDto);
  }

  @Put(':code/data')
  @ApiOkResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async updateKycDataByCode(@Param('code') code: string, @Body() data: KycUserDataDto): Promise<KycInfo> {
    return this.kycService.updateKycData(code, data);
  }

  @Post(':code/limit')
  @ApiOkResponse()
  @ApiOperation({ deprecated: true })
  async increaseLimitByCode(@Param('code') code: string, @Body() request: LimitRequestDto): Promise<void> {
    return this.limitRequestService.increaseLimit(request, code);
  }

  @Post(':code/incorporationCertificate')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiCreatedResponse({ type: Boolean })
  @ApiOperation({ deprecated: true })
  async uploadIncorporationCertificateByCode(
    @Param('code') code: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    return this.kycService.uploadDocument(code, files[0], FileType.USER_NOTES);
  }
}

@ApiTags('KYC Client')
@Controller('kyc')
export class KycClientController {
  constructor(private readonly kycService: KycService) {}

  @Get('users')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycDataDto, isArray: true })
  @ApiOperation({ deprecated: true })
  async getAllKycData(@GetJwt() jwt: JwtPayload): Promise<KycDataDto[]> {
    return this.kycService.getAllKycData(jwt.id);
  }

  @Get(':id/documents')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycFileDto, isArray: true })
  @ApiOperation({ deprecated: true })
  async getKycFiles(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<KycFileDto[]> {
    return this.kycService.getKycFiles(id, jwt.id);
  }

  @Get(':id/documents/:type')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: Buffer })
  @ApiOperation({ deprecated: true })
  async getKycFile(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Param('type') type: KycDocumentType,
  ): Promise<Buffer> {
    return this.kycService.getKycFile(id, jwt.id, type);
  }
}
