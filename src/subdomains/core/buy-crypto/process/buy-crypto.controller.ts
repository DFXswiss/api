import { Body, Controller, Delete, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UpdateBuyCryptoDto } from './dto/update-buy-crypto.dto';
import { BuyCrypto } from './entities/buy-crypto.entity';
import { BuyCryptoWebhookService } from './services/buy-crypto-webhook.service';
import { BuyCryptoService } from './services/buy-crypto.service';

@ApiTags('buyCrypto')
@Controller('buyCrypto')
export class BuyCryptoController {
  constructor(
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
  ) {}

  @Post(':id/webhook')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @ApiExcludeEndpoint()
  async triggerWebhook(@Param('id') id: string): Promise<void> {
    return this.buyCryptoWebhookService.triggerWebhookManual(+id);
  }

  @Post(':id/refund')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @ApiExcludeEndpoint()
  async refundBuyCrypto(@Param('id') id: string): Promise<void> {
    return this.buyCryptoService.refundBuyCrypto(+id);
  }

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateBuyVolumes(@Query('start') start?: string, @Query('end') end?: string): Promise<void> {
    return this.buyCryptoService.updateVolumes(start ? +start : undefined, end ? +end : undefined);
  }

  @Put('refVolumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateRefVolumes(@Query('start') start?: string, @Query('end') end?: string): Promise<void> {
    return this.buyCryptoService.updateRefVolumes(start ? +start : undefined, end ? +end : undefined);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateBuyCryptoDto): Promise<BuyCrypto> {
    return this.buyCryptoService.update(+id, dto);
  }

  @Delete(':id/amlCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async resetAmlCheck(@Param('id') id: string): Promise<void> {
    return this.buyCryptoService.resetAmlCheck(+id);
  }
}
