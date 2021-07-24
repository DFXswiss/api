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
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/guards/role.guard';
import { UserRole } from 'src/user/user.entity';
import { Country } from './country.entity';
import { CountryService } from './country.service';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';

@ApiTags('country')
@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get(':key')
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getCountry(@Param() country: any): Promise<any> {
    return this.countryService.getCountry(country);
  }

  @Get()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllCountry(): Promise<any> {
    return this.countryService.getAllCountry();
  }

  @Post()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UsePipes(ValidationPipe)
  createCountry(@Body() createCountryDto: CreateCountryDto): Promise<any> {
    return this.countryService.createCountry(createCountryDto);
  }

  @Put()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UsePipes(ValidationPipe)
  async updateCountryRoute(@Body() country: UpdateCountryDto) {
    return this.countryService.updateCountry(country);
  }
}
function GetCountry() {
  throw new Error('Function not implemented.');
}
