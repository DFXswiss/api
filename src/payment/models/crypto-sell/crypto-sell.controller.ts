import { Controller, UseGuards, Put, Body, Param, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CryptoSell } from './crypto-sell.entity';
import { CryptoSellService } from './crypto-sell.service';
import { CreateCryptoSellDto } from './dto/create-crypto-sell.dto';
import { UpdateCryptoSellDto } from './dto/update-crypto-sell.dto';

@ApiTags('cryptoSell')
@Controller('cryptoSell')
export class CryptoSellController {
  constructor(private readonly cryptoSellService: CryptoSellService) {}

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateVolumes(): Promise<void> {
    return this.cryptoSellService.updateVolumes();
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async create(@Body() dto: CreateCryptoSellDto): Promise<CryptoSell> {
    return this.cryptoSellService.create(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateCryptoSellDto): Promise<CryptoSell> {
    return this.cryptoSellService.update(+id, dto);
  }
}
