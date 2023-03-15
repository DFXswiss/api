import { Country } from '../country.entity';
import { CountryDto } from './country.dto';

export class CountryDtoMapper {
  static entityToDto(country: Country): CountryDto {
    const dto: CountryDto = {
      id: country.id,
      symbol: country.symbol,
      name: country.name,
    };

    return Object.assign(new CountryDto(), dto);
  }

  static entitiesToDto(countries: Country[]): CountryDto[] {
    return countries.map(CountryDtoMapper.entityToDto);
  }
}
