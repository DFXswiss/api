import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetConfig } from 'src/config/config';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { KycDataDto, KycFileDto, KycReportType } from '../dto/kyc-file.dto';
import { KycService } from '../services/kyc.service';

@ApiTags('KYC Client')
@Controller({ path: 'kyc/client', version: [GetConfig().kycVersion] })
export class KycClientController {
  constructor(private readonly kycService: KycService) {}

  @Get('users')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycDataDto, isArray: true })
  async getAllKycData(@GetJwt() jwt: JwtPayload): Promise<KycDataDto[]> {
    return this.kycService.getAllKycData(jwt.id);
  }

  @Get('users/:id/documents')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycFileDto, isArray: true })
  async getKycFiles(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<KycFileDto[]> {
    return this.kycService.getKycFiles(id, jwt.id);
  }

  @Get('users/:id/documents/:type')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: Buffer })
  async getKycFile(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Param('type') type: KycReportType,
  ): Promise<Buffer> {
    return this.kycService.getKycFile(id, jwt.id, type);
  }
}
