import { Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Price } from './domain/entities/price';
import { PriceRequest as PriceRequestOld, PriceResult } from './domain/interfaces';
import { PriceRequest } from './dto/price-request';
import { PricingService } from './services/pricing.service';
import { PricingServiceNew } from './services/pricing.service.new';

@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService, private readonly pricingServiceNew: PricingServiceNew) {}

  @Get('price')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getPriceOld(@Query() dto: PriceRequestOld): Promise<PriceResult> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.pricingService.getPrice(dto);
    }
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getPrice(@Query() dto: PriceRequest): Promise<Price> {
    return this.pricingServiceNew.getPriceFrom(dto.source, dto.from, dto.to);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updatePrices(): Promise<void> {
    return this.pricingServiceNew.updatePrices();
  }
}
