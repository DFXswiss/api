import { Body, Controller, Get, Param, Put, UseGuards, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/user/user.entity';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get(':key')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getWallet(@Param() wallet: any): Promise<any> {
    return this.walletService.getWallet(wallet);
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllWallet(): Promise<any> {
    return this.walletService.getAllWallet();
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createWallet(@Body() createWalletDto: CreateWalletDto): Promise<any> {
    return this.walletService.createWallet(createWalletDto);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateWalletRoute(@Body() wallet: UpdateWalletDto): Promise<any> {
    return this.walletService.updateWallet(wallet);
  }
}
