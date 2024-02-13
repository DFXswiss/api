import { Controller, Get, NotFoundException, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Price } from './domain/entities/price';
import { CurrencyType, PriceRequest } from './dto/price-request';
import { PriceRequestRaw } from './dto/price-request-raw';
import { PricingServiceNew } from './services/pricing.service.new';

@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricingServiceNew: PricingServiceNew,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
  ) {}

  @Get('price')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getPrice(@Query() dto: PriceRequest): Promise<Price> {
    const from = await this.getCurrency(dto.fromType, dto.fromId);
    const to = await this.getCurrency(dto.toType, dto.toId);
    if (!from || !to) throw new NotFoundException('Currency not found');

    return this.pricingServiceNew.getPrice(from, to, dto.allowExpired);
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getRawPrice(@Query() dto: PriceRequestRaw): Promise<Price> {
    return this.pricingServiceNew.getPriceFrom(dto.source, dto.from, dto.to);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updatePrices(): Promise<void> {
    return this.pricingServiceNew.updatePrices();
  }

  private async getCurrency(type: CurrencyType, id: number): Promise<Asset | Fiat> {
    return type === CurrencyType.ASSET ? this.assetService.getAssetById(id) : this.fiatService.getFiat(id);
  }
}
