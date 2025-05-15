import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { WalletDto } from './dto/wallet.dto';
import { Wallet } from './wallet.entity';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@Controller('wallet')
@ApiExcludeController()
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async createWallet(@Body() dto: WalletDto): Promise<Wallet> {
    return this.walletService.createWallet(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateWallet(@Param('id') id: string, @Body() wallet: WalletDto): Promise<Wallet> {
    return this.walletService.updateWallet(+id, wallet);
  }
}
