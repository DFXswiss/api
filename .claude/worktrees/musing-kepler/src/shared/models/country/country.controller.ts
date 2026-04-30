import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CountryService } from './country.service';
import { CountryDtoMapper } from './dto/country-dto.mapper';
import { CountryDto } from './dto/country.dto';

@ApiTags('Country')
@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  @ApiOkResponse({ type: CountryDto, isArray: true })
  async getAllCountry(): Promise<CountryDto[]> {
    return this.countryService.getAllCountry().then(CountryDtoMapper.entitiesToDto);
  }
}
