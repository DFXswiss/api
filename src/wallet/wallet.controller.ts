import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Request,
  ForbiddenException,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/guards/admin.guard';
import { Wallet } from './wallet.entity';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { GetWalletDto } from "./dto/get-wallet.dto";
import { UpdateWalletDto } from "./dto/update-wallet.dto";

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @UseGuards(AdminGuard)
  async getWallet(@Body() wallet: GetWalletDto): Promise<any> {
    return this.walletService.getWallet(wallet);
  }

  @Get('all')
  @UseGuards(AdminGuard)
  async getAllWallet(): Promise<any> {
    return this.walletService.getAllWallet();
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AdminGuard)
  createWallet(@Body() createWalletDto: CreateWalletDto): Promise<void> {
    return this.walletService.createWallet(createWalletDto);
  }

  @Put()
  @UseGuards(AdminGuard)
  async updateWalletRoute(@Body() wallet: UpdateWalletDto) {
    return this.walletService.updateWallet(wallet);
  }
}
