import { Body, Controller, Get, Param, Post, Put, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { KycDocument } from 'src/subdomains/generic/user/services/spider/dto/spider.dto';
import { LimitRequestDto } from '../limit-request/dto/limit-request.dto';
import { LimitRequestService } from '../limit-request/limit-request.service';
import { KycUserDataDto } from './dto/kyc-user-data.dto';
import { KycService } from './kyc.service';
import { AuthGuard } from '@nestjs/passport';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { KycDataTransferDto } from './dto/kyc-data-transfer.dto';
import { KycInfo } from './dto/kyc-info.dto';
import { Country } from 'src/shared/models/country/country.entity';
import { KycWebhookTriggerDto } from './dto/kyc-webhook-trigger.dto';

@ApiTags('KYC')
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService, private readonly limitRequestService: LimitRequestService) {}

  // --- TRANSFER --- //
  @Put('transfer')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  async transferKycData(@GetJwt() jwt: JwtPayload, @Body() data: KycDataTransferDto): Promise<void> {
    await this.kycService.transferKycData(jwt.id, data);
  }

  @Post('webhook')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @ApiExcludeEndpoint()
  async triggerWebhook(@Body() dto: KycWebhookTriggerDto): Promise<void> {
    await this.kycService.triggerWebhook(dto.userDataId, dto.reason);
  }

  // --- JWT Calls --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: KycInfo })
  async getKycProgress(@GetJwt() jwt: JwtPayload): Promise<KycInfo> {
    return await this.kycService.getKycStatus('', jwt.id);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: KycInfo })
  async requestKyc(@GetJwt() jwt: JwtPayload): Promise<KycInfo> {
    return await this.kycService.requestKyc('', jwt.id);
  }

  @Get('countries')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: Country, isArray: true })
  async getKycCountries(@GetJwt() jwt: JwtPayload): Promise<Country[]> {
    return await this.kycService.getKycCountries('', jwt.id);
  }

  @Post('data')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: KycInfo })
  async updateKycData(@GetJwt() jwt: JwtPayload, @Body() data: KycUserDataDto): Promise<KycInfo> {
    return await this.kycService.updateKycData('', data, jwt.id);
  }

  @Post('limit')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  async increaseLimit(@GetJwt() jwt: JwtPayload, @Body() request: LimitRequestDto): Promise<void> {
    return await this.limitRequestService.increaseLimit(request, '', jwt.id);
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
    return this.kycService.uploadDocument('', files[0], KycDocument.INCORPORATION_CERTIFICATE, jwt.id);
  }

  // --- CODE CALLS --- //
  @Get(':code')
  @ApiOkResponse({ type: KycInfo })
  async getKycProgressByCode(@Param('code') code: string): Promise<KycInfo> {
    return await this.kycService.getKycStatus(code);
  }

  @Post(':code')
  @ApiCreatedResponse({ type: KycInfo })
  async requestKycByCode(@Param('code') code: string): Promise<KycInfo> {
    return await this.kycService.requestKyc(code);
  }

  @Get(':code/countries')
  @ApiOkResponse({ type: Country, isArray: true })
  async getKycCountriesByCode(@Param('code') code: string): Promise<Country[]> {
    return await this.kycService.getKycCountries(code);
  }

  @Put(':code/data')
  @ApiOkResponse({ type: KycInfo })
  async updateKycDataByCode(@Param('code') code: string, @Body() data: KycUserDataDto): Promise<KycInfo> {
    return await this.kycService.updateKycData(code, data);
  }

  @Post(':code/limit')
  @ApiOkResponse()
  async increaseLimitByCode(@Param('code') code: string, @Body() request: LimitRequestDto): Promise<void> {
    return await this.limitRequestService.increaseLimit(request, code);
  }

  @Post(':code/incorporationCertificate')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiCreatedResponse({ type: Boolean })
  async uploadIncorporationCertificateByCode(
    @Param('code') code: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    return this.kycService.uploadDocument(code, files[0], KycDocument.INCORPORATION_CERTIFICATE);
  }
}
