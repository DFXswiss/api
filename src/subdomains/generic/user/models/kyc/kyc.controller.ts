import { Body, Controller, Get, Param, Post, Put, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CountryDto } from 'src/shared/models/country/dto/country.dto';
import { KycContentType, KycFileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { DocumentStorageService } from 'src/subdomains/generic/kyc/services/integration/document-storage.service';
import { LimitRequestDto } from '../limit-request/dto/limit-request.dto';
import { LimitRequestService } from '../limit-request/limit-request.service';
import { KycDataTransferDto } from './dto/kyc-data-transfer.dto';
import { KycDataDto } from './dto/kyc-data.dto';
import { KycDocumentType, KycFileDto } from './dto/kyc-file.dto';
import { KycInfo } from './dto/kyc-info.dto';
import { KycUserDataDto } from './dto/kyc-user-data.dto';
import { KycWebhookTriggerDto } from './dto/kyc-webhook-trigger.dto';

@ApiTags('KYC')
@Controller('kyc')
export class KycController {
  constructor(
    private readonly storageService: DocumentStorageService,
    private readonly limitRequestService: LimitRequestService,
  ) {}

  // --- TRANSFER --- //
  @Put('transfer')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  async transferKycData(@GetJwt() jwt: JwtPayload, @Body() data: KycDataTransferDto): Promise<void> {
    return; //TODO
  }

  @Post('webhook')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @ApiExcludeEndpoint()
  async triggerWebhook(@Body() dto: KycWebhookTriggerDto): Promise<void> {
    return; //TODO
  }

  // --- JWT Calls --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: KycInfo })
  async getKycProgress(@GetJwt() jwt: JwtPayload): Promise<KycInfo> {
    return; //TODO
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: KycInfo })
  async requestKyc(@GetJwt() jwt: JwtPayload): Promise<KycInfo> {
    return; //TODO
  }

  @Get('countries')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: CountryDto, isArray: true })
  async getKycCountries(@GetJwt() jwt: JwtPayload): Promise<CountryDto[]> {
    return; //TODO
  }

  @Post('data')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: KycInfo })
  async updateKycData(@GetJwt() jwt: JwtPayload, @Body() data: KycUserDataDto): Promise<KycInfo> {
    return; //TODO
  }

  @Post('limit')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  async increaseLimit(@GetJwt() jwt: JwtPayload, @Body() request: LimitRequestDto): Promise<void> {
    return this.limitRequestService.increaseLimit(request, '', jwt.id);
  }

  @Post('incorporationCertificate')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @UseInterceptors(FilesInterceptor('files'))
  @ApiCreatedResponse({ type: Boolean })
  async uploadIncorporationCertificate(
    @GetJwt() jwt: JwtPayload,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    const upload = await this.storageService.uploadFile(
      jwt.id,
      KycFileType.USER_NOTES,
      files[0].filename,
      files[0].buffer,
      files[0].mimetype as KycContentType,
    );
    return upload != '';
  }

  // --- CODE CALLS --- //
  @Get(':code')
  @ApiOkResponse({ type: KycInfo })
  async getKycProgressByCode(@Param('code') code: string): Promise<KycInfo> {
    return; //TODO
  }

  @Post(':code')
  @ApiCreatedResponse({ type: KycInfo })
  async requestKycByCode(@Param('code') code: string): Promise<KycInfo> {
    return; //TODO
  }

  @Get(':code/countries')
  @ApiOkResponse({ type: CountryDto, isArray: true })
  async getKycCountriesByCode(@Param('code') code: string): Promise<CountryDto[]> {
    return; //TODO
  }

  @Put(':code/data')
  @ApiOkResponse({ type: KycInfo })
  async updateKycDataByCode(@Param('code') code: string, @Body() data: KycUserDataDto): Promise<KycInfo> {
    return; //TODO
  }

  @Post(':code/limit')
  @ApiOkResponse()
  async increaseLimitByCode(@Param('code') code: string, @Body() request: LimitRequestDto): Promise<void> {
    return this.limitRequestService.increaseLimit(request, code);
  }

  @Post(':code/incorporationCertificate')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiCreatedResponse({ type: Boolean })
  async uploadIncorporationCertificateByCode(
    @Param('code') code: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    return; //TODO
  }
}

@ApiTags('KYC Client')
@Controller('kyc')
export class KycClientController {
  @Get('users')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycDataDto, isArray: true })
  async getAllKycData(@GetJwt() jwt: JwtPayload): Promise<KycDataDto[]> {
    return; //TODO
  }

  @Get(':id/documents')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycFileDto, isArray: true })
  async getKycFiles(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<KycFileDto[]> {
    return; //TODO
  }

  @Get(':id/documents/:type')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: Buffer })
  async getKycFile(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Param('type') type: KycDocumentType,
  ): Promise<Buffer> {
    return; //TODO
  }
}
