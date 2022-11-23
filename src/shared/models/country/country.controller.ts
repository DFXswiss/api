import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CountryDto } from './country.dto';
import { Country } from './country.entity';
import { CountryService } from './country.service';

@ApiTags('country')
@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  @ApiOkResponse({ type: CountryDto, isArray: true })
  async getAllCountry(): Promise<CountryDto[]> {
    return this.countryService.getAllCountry().then((c) => c.map(this.entityToDto));
  }

  private entityToDto(country: Country): CountryDto {
    return {
      id: country.id,
      symbol: country.symbol,
      name: country.name,
      enable: country.dfxEnable,
    };
  }
}
