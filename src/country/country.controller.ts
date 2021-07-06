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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/guards/admin.guard';
import { Country } from './country.entity';
import { CountryService } from './country.service';
import { CreateCountryDto } from './dto/create-country.dto';

@ApiTags('country')
@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  async getCountry(country: Country): Promise<any> {
    console.log("test");
   return country;
   
  }

  // @Get()
  // async getCountryRoute(): Promise<any> {
  //   return this.countryService.getCountry();
  //}

  @Get('symbol')
  async getCountryByKey(@Param() symbol: string): Promise<any> {
    return this.countryService.findCountryBySymbol(symbol);
  }

  @Post()
  @UsePipes(ValidationPipe)
  createCountry(@Body() createCountryDto: CreateCountryDto): Promise<void> {
    return this.countryService.createCountry(createCountryDto);
  }

  // @Post()
  // @UseGuards(AdminGuard)
  // async createCountryRoute(@Body() country: Country, @Request() req) {
  //   if (this.countryService.getCountry() != null) return 'Already exist';
  //   return this.countryService.createCountry(country);
  // }

  @Put()
  @UseGuards(AdminGuard)
  async updateCountryRoute(@Body() country: Country, @Request() req) {
    if (this.countryService.getCountry() == null) return 'Not exist';
    return this.countryService.updateCountry(country);
  }
}
function GetCountry() {
  throw new Error('Function not implemented.');
}

