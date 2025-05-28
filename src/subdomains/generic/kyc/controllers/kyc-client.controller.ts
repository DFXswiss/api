import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetConfig } from 'src/config/config';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PaymentWebhookData } from '../../user/services/webhook/dto/payment-webhook.dto';
import { KycClientDataDto, KycReportDto, KycReportType } from '../dto/kyc-file.dto';
import { KycClientService } from '../services/kyc-client.service';

@ApiTags('KYC Client')
@Controller({ path: 'kyc/client', version: [GetConfig().kycVersion] })
export class KycClientController {
  constructor(private readonly kycClientService: KycClientService) {}

  @Get('users')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycClientDataDto, isArray: true })
  async getAllKycData(@GetJwt() jwt: JwtPayload): Promise<KycClientDataDto[]> {
    return this.kycClientService.getAllKycData(jwt.user);
  }

  @Get('payments')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: PaymentWebhookData, isArray: true })
  async getAllPayments(
    @GetJwt() jwt: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<PaymentWebhookData[]> {
    return this.kycClientService.getAllPayments(
      jwt.user,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('users/:id/documents')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycReportDto, isArray: true })
  async getKycFiles(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<KycReportDto[]> {
    return this.kycClientService.getKycFiles(id, jwt.user);
  }

  @Get('users/:id/documents/:type')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: Buffer })
  async getKycFile(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Param('type') type: KycReportType,
  ): Promise<Buffer> {
    return this.kycClientService.getKycFile(id, jwt.user, type);
  }

  @Get('users/:id/payments')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: PaymentWebhookData, isArray: true })
  async getUserPayments(
    @GetJwt() jwt: JwtPayload,
    @Param('id') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<PaymentWebhookData[]> {
    return this.kycClientService.getAllUserPayments(
      jwt.user,
      userId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }
}
