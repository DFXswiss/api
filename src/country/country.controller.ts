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
import { GetCountryDto } from './dto/get-country.dto';
import { UpdateCountryDto } from "./dto/update-country.dto";

@ApiTags('country')
@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  @UsePipes(ValidationPipe)
  async getCountry(@Body() getCountryDto: GetCountryDto): Promise<any> {
    return this.countryService.getCountry(getCountryDto); 
  }

  @Get('all')
  async getAllCountry(): Promise<any> {
    return this.countryService.getAllCountry(); 
  }

  @Post()
  @UseGuards(AdminGuard)
  @UsePipes(ValidationPipe)
  createCountry(@Body() createCountryDto: CreateCountryDto): Promise<any> {
    return this.countryService.createCountry(createCountryDto);
  }

  @Put()
  @UseGuards(AdminGuard)
  @UsePipes(ValidationPipe)
  async updateCountryRoute(@Body() country: UpdateCountryDto) {
    return this.countryService.updateCountry(country);
  }
}
function GetCountry() {
  throw new Error('Function not implemented.');
}

