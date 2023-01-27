import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { WalletService } from './wallet.service';
import { WalletDto } from './dto/wallet.dto';
import { Wallet } from './wallet.entity';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { User } from '../user/user.entity';
import { KycDataDto } from './dto/kyc-data.dto';
import { WebhookService } from '../../services/webhook/webhook.service';

@ApiTags('Wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService, private readonly webhookService: WebhookService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: WalletDto, isArray: true })
  async getAllExternalService(): Promise<WalletDto[]> {
    return this.walletService.getAllExternalServices().then((l) => this.toDtoList(l));
  }

  @Get('kycData')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.KYC_CLIENT_COMPANY))
  @ApiOkResponse({ type: KycDataDto, isArray: true })
  async getAllKycData(@GetJwt() jwt: JwtPayload): Promise<KycDataDto[]> {
    return this.walletService.getAllKycData(jwt.id).then((l) => this.toKycDataDtoList(l));
  }

  // --- DTO --- //
  private async toDtoList(wallets: Wallet[]): Promise<WalletDto[]> {
    return Promise.all(wallets.map((b) => this.toDto(b)));
  }

  private async toKycDataDtoList(users: User[]): Promise<KycDataDto[]> {
    return Promise.all(users.map((b) => this.toKycDataDto(b)));
  }

  private async toKycDataDto(user: User): Promise<KycDataDto> {
    return {
      address: user.address,
      kycStatus: this.webhookService.getKycWebhookStatus(user.userData.kycStatus, user.userData.kycType),
      kycHash: user.userData.kycHash,
    };
  }

  private async toDto(wallet: Wallet): Promise<WalletDto> {
    return {
      name: wallet.name,
    };
  }
}
