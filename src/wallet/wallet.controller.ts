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
import { RoleGuard } from 'src/guards/role.guard';
import { Wallet } from './wallet.entity';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { GetWalletDto } from "./dto/get-wallet.dto";
import { UpdateWalletDto } from "./dto/update-wallet.dto";
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/user/user.entity';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get(':key')
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getWallet(@Param() wallet: any): Promise<any> {
    return this.walletService.getWallet(wallet);
  }

  @Get()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllWallet(): Promise<any> {
    return this.walletService.getAllWallet();
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createWallet(@Body() createWalletDto: CreateWalletDto): Promise<void> {
    return this.walletService.createWallet(createWalletDto);
  }

  @Put()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateWalletRoute(@Body() wallet: UpdateWalletDto) {
    return this.walletService.updateWallet(wallet);
  }
}
