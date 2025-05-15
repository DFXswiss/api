import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CountryDtoMapper } from 'src/shared/models/country/dto/country-dto.mapper';
import { CountryDto } from 'src/shared/models/country/dto/country.dto';
import { KycDataTransferDto } from './dto/kyc-data-transfer.dto';
import { KycDataDto } from './dto/kyc-data.dto';
import { KycDocumentType, KycFileDto } from './dto/kyc-file.dto';
import { KycInfo } from './dto/kyc-info.dto';
import { KycService } from './kyc.service';

@ApiTags('KYC')
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // --- TRANSFER --- //
  @Put('transfer')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse()
  @ApiOperation({ deprecated: true })
  async transferKycDataV1(@GetJwt() jwt: JwtPayload, @Body() data: KycDataTransferDto): Promise<void> {
    await this.kycService.transferKycData(jwt.user, data);
  }

  // --- JWT Calls --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async getKycProgressV1(@GetJwt() jwt: JwtPayload): Promise<KycInfo> {
    return this.kycService.getKycInfo('', jwt.account);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiCreatedResponse({ type: KycInfo })
  @ApiOperation({ deprecated: true })
  async requestKycV1(@GetJwt() jwt: JwtPayload): Promise<KycInfo> {
    return this.kycService.requestKyc('', jwt.account);
  }

  @Get('countries')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: CountryDto, isArray: true })
  @ApiOperation({ deprecated: true })
  async getKycCountriesV1(@GetJwt() jwt: JwtPayload): Promise<CountryDto[]> {
    return this.kycService.getKycCountries('', jwt.account).then(CountryDtoMapper.entitiesToDto);
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
}

@ApiTags('KYC Client')
@Controller('kyc')
export class KycClientController {
  constructor(private readonly kycService: KycService) {}

  @Get('users')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycDataDto, isArray: true })
  @ApiOperation({ deprecated: true })
  async getAllKycDataV1(@GetJwt() jwt: JwtPayload): Promise<KycDataDto[]> {
    return this.kycService.getAllKycData(jwt.user);
  }

  @Get(':id/documents')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycFileDto, isArray: true })
  @ApiOperation({ deprecated: true })
  async getKycFilesV1(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<KycFileDto[]> {
    return this.kycService.getKycFiles(id, jwt.user);
  }

  @Get(':id/documents/:type')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.KYC_CLIENT_COMPANY))
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
