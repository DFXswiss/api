import { Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PriceRequest, PriceResult } from './domain/interfaces';
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
  async getPrice(@Query() dto: PriceRequest): Promise<PriceResult> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.pricingService.getPrice(dto);
    }
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updatePrices(): Promise<void> {
    return this.pricingServiceNew.updatePrices();
  }
}
