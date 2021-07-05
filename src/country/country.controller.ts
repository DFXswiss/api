import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Request,
  ForbiddenException,
  Post
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/guards/admin.guard';
import { Country } from './country.entity';
import { CountryService } from './country.service';

@ApiTags('country')
@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  async getCountryRoute(): Promise<any> {
    return this.countryService.getCountry();
  }

  @Get('symbol')
  async getCountryByKey(@Param() symbol: string): Promise<any> {
    return this.countryService.findCountryBySymbol(symbol);
  }

  @Post()
  @UseGuards(AdminGuard)
  async createCountryRoute(@Body() country: Country, @Request() req) {
    if (this.countryService.getCountry() != null) return 'Already exist';
    return this.countryService.createCountry(country);
  }

  @Put()
  @UseGuards(AdminGuard)
  async updateCountryRoute(@Body() country: Country, @Request() req) {
    if (this.countryService.getCountry() == null) return 'Not exist';
    return this.countryService.updateCountry(country);
  }
}
