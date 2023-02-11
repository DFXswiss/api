import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { WalletService } from './wallet.service';
import { WalletDto } from './dto/wallet.dto';
import { Wallet } from './wallet.entity';

@ApiTags('Wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: WalletDto, isArray: true })
  async getAllExternalService(): Promise<WalletDto[]> {
    return this.walletService.getAllExternalServices().then((l) => this.toDtoList(l));
  }

  // --- DTO --- //
  private async toDtoList(wallets: Wallet[]): Promise<WalletDto[]> {
    return Promise.all(wallets.map((b) => this.toDto(b)));
  }

  private async toDto(wallet: Wallet): Promise<WalletDto> {
    return {
      name: wallet.name,
    };
  }
}
