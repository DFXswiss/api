import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Request,
  ForbiddenException,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserGuard } from 'src/auth/user.guard';
import { AdminGuard } from 'src/auth/admin.guard';
import { Country } from './country.entity';
import { CountryService } from './country.service';

@ApiTags('country')
@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  @UseGuards(UserGuard)
  async getCountryRoute(): Promise<any> {
    return this.countryService.findCountryByAddress();
  }

  @Get('symbol')
  @UseGuards(UserGuard)
  async getCountryByKey(@Query() symbol: string): Promise<any> {
    return this.countryService.findCountryBySymbol(symbol);
  }

  @Post()
  @UseGuards(AdminGuard)
  async createCountryRoute(@Body() country: Country, @Request() req) {
    if (this.countryService.findCountryByAddress() != null) return 'Already exist';
    return this.countryService.createCountry(country);
  }

  @Put()
  @UseGuards(AdminGuard)
  async updateCountryRoute(@Body() country: Country, @Request() req) {
    if (this.countryService.findCountryByAddress() == null) return 'Not exist';
    return this.countryService.updateCountry(country);
  }
}
