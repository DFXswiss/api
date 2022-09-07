import { Country } from '../../country.entity';

const defaultCountry: Partial<Country> = {
  id: 1,
  symbol: 'DE',
  name: 'Germany',
  enable: true,
  ipEnable: true,
  maerkiBaumannEnable: true,
  updated: undefined,
  created: undefined,
};

export function createDefaultCountry(): Country {
  return createCustomCountry({});
}

export function createCustomCountry(customValues: Partial<Country>): Country {
  return Object.assign(new Country(), { ...defaultCountry, ...customValues });
}
