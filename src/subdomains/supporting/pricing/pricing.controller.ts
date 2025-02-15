import { Controller, Get, NotFoundException, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Active } from 'src/shared/models/active';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Price } from './domain/entities/price';
import { CurrencyType, PriceRequest } from './dto/price-request';
import { PriceRequestRaw } from './dto/price-request-raw';
import { PricingService } from './services/pricing.service';

@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
  ) {}

  @Get('price')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async getPrice(@Query() dto: PriceRequest): Promise<Price> {
    const from = await this.getCurrency(dto.fromType, +dto.fromId);
    const to = await this.getCurrency(dto.toType, +dto.toId);
    if (!from || !to) throw new NotFoundException('Currency not found');

    return this.pricingService.getPrice(from, to, dto.allowExpired === 'true');
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async getRawPrice(@Query() dto: PriceRequestRaw): Promise<Price> {
    return this.pricingService.getPriceFrom(dto.source, dto.from, dto.to, dto.param);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async updatePrices(): Promise<void> {
    return this.pricingService.updatePrices();
  }

  private async getCurrency(type: CurrencyType, id: number): Promise<Active> {
    return type === CurrencyType.ASSET ? this.assetService.getAssetById(id) : this.fiatService.getFiat(id);
  }
}
