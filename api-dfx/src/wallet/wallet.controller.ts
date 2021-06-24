import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Request,
  ForbiddenException,
  Post
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/admin.guard';
import { Wallet } from './wallet.entity';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @UseGuards(AdminGuard)
  async getWalletRoute(): Promise<any> {
    return this.walletService.findWalletByAddress();
  }

  @Get('key')
  @UseGuards(AdminGuard)
  async getWalletByKey(@Param() key: string): Promise<any> {
    return this.walletService.findWalletByKey(key);
  }

  @Post()
  @UseGuards(AdminGuard)
  async createWalletRoute(@Body() wallet: Wallet, @Request() req) {
    if (this.walletService.findWalletByAddress() != null) return 'Already exist';
    return this.walletService.createWallet(wallet);
  }

  @Put()
  @UseGuards(AdminGuard)
  async updateWalletRoute(@Body() wallet: Wallet, @Request() req) {
    if (this.walletService.findWalletByAddress() == null) return 'Not exist';
    return this.walletService.updateWallet(wallet);
  }
}
