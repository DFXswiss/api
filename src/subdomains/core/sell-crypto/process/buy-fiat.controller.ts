import { Body, Controller, Delete, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BuyFiat } from './buy-fiat.entity';
import { BuyFiatService } from './buy-fiat.service';
import { UpdateBuyFiatDto } from './dto/update-buy-fiat.dto';

@ApiTags('buyFiat')
@Controller('buyFiat')
export class BuyFiatController {
  constructor(private readonly buyFiatService: BuyFiatService) {}

  @Post(':id/webhook')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @ApiExcludeEndpoint()
  async triggerWebhook(@Param('id') id: string): Promise<void> {
    return this.buyFiatService.triggerWebhookManual(+id);
  }

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateVolumes(@Query('start') start?: string, @Query('end') end?: string): Promise<void> {
    return this.buyFiatService.updateVolumes(start ? +start : undefined, end ? +end : undefined);
  }

  @Put('refVolumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateRefVolumes(): Promise<void> {
    return this.buyFiatService.updateRefVolumes();
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateBuyFiatDto): Promise<BuyFiat> {
    return this.buyFiatService.update(+id, dto);
  }

  @Delete(':id/amlCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async resetAmlCheck(@Param('id') id: string): Promise<void> {
    return this.buyFiatService.resetAmlCheck(+id);
  }
}
