import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Country } from './country.entity';
import { CountryService } from './country.service';

@ApiTags('country')
@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  async getAllCountry(): Promise<Country[]> {
    return this.countryService.getAllCountry();
  }
}
