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
import { KycDataTransferDto } from './dto/kyc-data-transfer.dto';
import { KycDataDto } from './dto/kyc-data.dto';
import { KycDocumentType, KycFileDto } from './dto/kyc-file.dto';
import { KycInfo } from './dto/kyc-info.dto';
import { KycUserDataDto } from './dto/kyc-user-data.dto';
import { KycService } from './kyc.service';

@ApiTags('KYC')
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // --- TRANSFER --- //
  @Put('transfer')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  @ApiOperation({ deprecated: true })
  async transferKycDataV1(@GetJwt() jwt: JwtPayload, @Body() data: KycDataTransferDto): Promise<void> {
    await this.kycService.transferKycData(jwt.user, data);
  }

  // --- JWT Calls --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async getKycProgressV1(@GetJwt() jwt: JwtPayload): Promise<KycInfo> {
    return this.kycService.getKycInfo('', jwt.account);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiCreatedResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async requestKycV1(@GetJwt() jwt: JwtPayload): Promise<KycInfo> {
    return this.kycService.requestKyc('', jwt.account);
  }

  @Get('countries')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: CountryDto, isArray: true })
  @ApiOperation({ deprecated: true })
  async getKycCountriesV1(@GetJwt() jwt: JwtPayload): Promise<CountryDto[]> {
    return this.kycService.getKycCountries('', jwt.account).then(CountryDtoMapper.entitiesToDto);
  }

  @Post('data')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiCreatedResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async updateKycDataV1(@GetJwt() jwt: JwtPayload, @Body() data: KycUserDataDto): Promise<KycInfo> {
    return this.kycService.updateKycData('', data, jwt.account);
  }

  @Post('incorporationCertificate')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @UseInterceptors(FilesInterceptor('files'))
  @ApiCreatedResponse({ type: Boolean })
  @ApiOperation({ deprecated: true })
  async uploadIncorporationCertificateV1(
    @GetJwt() jwt: JwtPayload,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    return this.kycService.uploadDocument('', files[0], FileType.USER_NOTES, jwt.account);
  }

  // --- CODE CALLS --- //
  @Get(':code')
  @ApiOkResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async getKycProgressByCodeV1(@Param('code') code: string): Promise<KycInfo> {
    return this.kycService.getKycInfo(code);
  }

  @Post(':code')
  @ApiCreatedResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async requestKycByCodeV1(@Param('code') code: string): Promise<KycInfo> {
    return this.kycService.requestKyc(code);
  }

  @Get(':code/countries')
  @ApiOkResponse({ type: CountryDto, isArray: true })
  @ApiOperation({ deprecated: true })
  async getKycCountriesByCodeV1(@Param('code') code: string): Promise<CountryDto[]> {
    return this.kycService.getKycCountries(code).then(CountryDtoMapper.entitiesToDto);
  }

  @Put(':code/data')
  @ApiOkResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async updateKycDataByCodeV1(@Param('code') code: string, @Body() data: KycUserDataDto): Promise<KycInfo> {
    return this.kycService.updateKycData(code, data);
  }

  @Post(':code/incorporationCertificate')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiCreatedResponse({ type: Boolean })
  @ApiOperation({ deprecated: true })
  async uploadIncorporationCertificateByCodeV1(
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
  async getAllKycDataV1(@GetJwt() jwt: JwtPayload): Promise<KycDataDto[]> {
    return this.kycService.getAllKycData(jwt.user);
  }

  @Get(':id/documents')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycFileDto, isArray: true })
  @ApiOperation({ deprecated: true })
  async getKycFilesV1(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<KycFileDto[]> {
    return this.kycService.getKycFiles(id, jwt.user);
  }

  @Get(':id/documents/:type')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: Buffer })
  @ApiOperation({ deprecated: true })
  async getKycFileV1(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Param('type') type: KycDocumentType,
  ): Promise<Buffer> {
    return this.kycService.getKycFile(id, jwt.user, type);
  }
}
