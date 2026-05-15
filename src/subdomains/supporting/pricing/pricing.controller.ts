import { Controller, Get, NotFoundException, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CoinListResponseItem } from 'coingecko-api-v3';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Active } from 'src/shared/models/active';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Price } from './domain/entities/price';
import { CoinsListRequest } from './dto/coins-list-request';
import { CurrencyType, PriceRequest } from './dto/price-request';
import { PriceRequestRaw } from './dto/price-request-raw';
import { CoinGeckoService } from './services/integration/coin-gecko.service';
import { PricingService } from './services/pricing.service';

@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly coinGeckoService: CoinGeckoService,
  ) {}

  @Get('coins-list')
  @ApiOperation({
    summary: 'CoinGecko coins/list proxy',
    description:
      'Public, cached pass-through to CoinGecko /coins/list using the central CoinGecko Pro key. ' +
      'Response is cached server-side for 24 h.',
  })
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          symbol: { type: 'string' },
          name: { type: 'string' },
          platforms: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
      example: [
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', platforms: {} },
        {
          id: 'tether',
          symbol: 'usdt',
          name: 'Tether',
          platforms: { ethereum: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
        },
      ],
    },
  })
  async getCoinsList(@Query() dto: CoinsListRequest): Promise<CoinListResponseItem[]> {
    return this.coinGeckoService.getCoinsList(dto.include_platform ?? false);
  }

  @Get('price')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getPrice(@Query() dto: PriceRequest): Promise<Price> {
    const from = await this.getCurrency(dto.fromType, +dto.fromId);
    const to = await this.getCurrency(dto.toType, +dto.toId);
    if (!from || !to) throw new NotFoundException('Currency not found');

    return this.pricingService.getPrice(from, to, dto.validity);
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getRawPrice(@Query() dto: PriceRequestRaw): Promise<Price> {
    return this.pricingService.getPriceFrom(dto.source, dto.from, dto.to, dto.param);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updatePrices(): Promise<void> {
    return this.pricingService.updatePrices();
  }

  private async getCurrency(type: CurrencyType, id: number): Promise<Active> {
    return type === CurrencyType.ASSET ? this.assetService.getAssetById(id) : this.fiatService.getFiat(id);
  }
}
