import { Country } from '../../country.entity';

export function createDefaultCountry(): Country {
  return {
    id: 1,
    symbol: 'DE',
    name: 'Germany',
    enable: true,
    ipEnable: true,
    updated: undefined,
    created: undefined,
  };
}
