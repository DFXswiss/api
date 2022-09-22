import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { KycDocument } from 'src/user/services/spider/dto/spider.dto';
import { LimitRequestDto } from '../limit-request/dto/limit-request.dto';
import { LimitRequestService } from '../limit-request/limit-request.service';
import { KycUserDataDto } from '../kyc/dto/kyc-user-data.dto';
import { KycInfo, KycService } from './kyc.service';
import { AuthGuard } from '@nestjs/passport';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { KycDataTransferDto } from './dto/kyc-data-transfer.dto';

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService, private readonly limitRequestService: LimitRequestService) {}

  // --- DEPRECATED CALLS --- //
  @Get()
  @ApiOperation({ deprecated: true })
  async getKycProgress(@Query('code') code: string): Promise<KycInfo> {
    return await this.kycService.getKycStatus(code);
  }

  @Post()
  @ApiOperation({ deprecated: true })
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async requestKyc(@GetJwt() jwt: JwtPayload): Promise<string> {
    return await this.kycService.requestKyc('', jwt.id).then((info) => JSON.stringify(info.kycHash));
  }

  // This call is in use by mobile applications, we need to carry it a while longer
  @Post('data')
  @ApiOperation({ deprecated: true })
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateKycData(@GetJwt() jwt: JwtPayload, @Body() data: KycUserDataDto): Promise<boolean> {
    await this.kycService.updateKycData('', data, jwt.id);
    return true;
  }

  @Post('limit')
  @ApiOperation({ deprecated: true })
  async increaseLimit(@Query('code') code: string, @Body() request: LimitRequestDto): Promise<void> {
    return await this.limitRequestService.increaseLimit(code, request);
  }

  @Post('incorporationCertificate')
  @ApiOperation({ deprecated: true })
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @UseInterceptors(FilesInterceptor('files'))
  async uploadIncorporationCertificate(
    @GetJwt() jwt: JwtPayload,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    return this.kycService.uploadDocument('', files[0], KycDocument.INCORPORATION_CERTIFICATE, jwt.id);
  }

  // --- NEW CALLS --- //
  @Put('transfer')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async transferKycData(@GetJwt() jwt: JwtPayload, @Body() data: KycDataTransferDto): Promise<void> {
    await this.kycService.transferKycData(jwt.id, data);
  }

  @Get(':code')
  async getKycProgressByCode(@Param('code') code: string): Promise<KycInfo> {
    return await this.kycService.getKycStatus(code);
  }

  @Post(':code')
  async requestKycByCode(@Param('code') code: string): Promise<KycInfo> {
    return await this.kycService.requestKyc(code);
  }

  @Put(':code/data')
  async updateKycDataByCode(@Param('code') code: string, @Body() data: KycUserDataDto): Promise<KycInfo> {
    return await this.kycService.updateKycData(code, data);
  }

  @Post(':code/limit')
  async increaseLimitByCode(@Param('code') code: string, @Body() request: LimitRequestDto): Promise<void> {
    return await this.limitRequestService.increaseLimit(code, request);
  }

  @Post(':code/incorporationCertificate')
  @UseInterceptors(FilesInterceptor('files'))
  async uploadIncorporationCertificateByCode(
    @Param('code') code: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    return this.kycService.uploadDocument(code, files[0], KycDocument.INCORPORATION_CERTIFICATE);
  }
}
