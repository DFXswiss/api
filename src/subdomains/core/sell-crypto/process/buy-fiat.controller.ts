import { Body, Controller, Delete, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { TfaGuard } from 'src/subdomains/generic/kyc/guards/tfa.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RefundInternalDto } from '../../history/dto/refund-internal.dto';
import { BuyFiat } from './buy-fiat.entity';
import { ManualAmlCheckDto } from '../../aml/dto/manual-aml-check.dto';
import { UpdateBuyFiatDto } from './dto/update-buy-fiat.dto';
import { BuyFiatService } from './services/buy-fiat.service';

@ApiTags('buyFiat')
@Controller('buyFiat')
export class BuyFiatController {
  constructor(private readonly buyFiatService: BuyFiatService) {}

  @Post(':id/webhook')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  @ApiExcludeEndpoint()
  async triggerWebhook(@Param('id') id: string): Promise<void> {
    return this.buyFiatService.triggerWebhookManual(+id);
  }

  @Post(':id/refund')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  @ApiExcludeEndpoint()
  async refundBuyFiat(@Param('id') id: string, @Body() dto: RefundInternalDto): Promise<void> {
    return this.buyFiatService.refundBuyFiat(+id, dto);
  }

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateVolumes(@Query('start') start?: string, @Query('end') end?: string): Promise<void> {
    return this.buyFiatService.updateVolumes(start ? +start : undefined, end ? +end : undefined);
  }

  @Put('refVolumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateRefVolumes(@Query('start') start?: string, @Query('end') end?: string): Promise<void> {
    return this.buyFiatService.updateRefVolumes(start ? +start : undefined, end ? +end : undefined);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateBuyFiatDto): Promise<BuyFiat> {
    return this.buyFiatService.update(+id, dto);
  }

  @Delete(':id/amlCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async resetAmlCheck(@Param('id') id: string): Promise<void> {
    return this.buyFiatService.resetAmlCheck(+id);
  }

  @Put(':id/amlCheck')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async manualPassAmlCheck(@Param('id') id: string, @Body() dto: ManualAmlCheckDto): Promise<BuyFiat> {
    return this.buyFiatService.manualPassAmlCheck(+id, dto);
  }
}
