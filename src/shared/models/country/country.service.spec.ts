import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Country } from './country.entity';
import { CountryRepository } from './country.repository';
import { CountryService } from './country.service';

const buildCountry = (overrides: Partial<Country> = {}): Country =>
  Object.assign(new Country(), {
    id: 1,
    symbol: 'XX',
    symbol3: 'XXX',
    name: 'Generic',
    foreignName: 'Generic',
    dfxEnable: true,
    dfxOrganizationEnable: true,
    lockEnable: true,
    ipEnable: true,
    yapealEnable: false,
    fatfEnable: true,
    nationalityEnable: true,
    nationalityStepEnable: true,
    bankTransactionVerificationEnable: false,
    bankEnable: true,
    cryptoEnable: true,
    checkoutEnable: true,
    manualReviewRequired: false,
    manualReviewRequiredOrganization: false,
    displayOrder: 999,
    ...overrides,
  });

describe('CountryService.getAllCountry', () => {
  let service: CountryService;
  let repo: jest.Mocked<CountryRepository>;

  beforeEach(async () => {
    repo = createMock<CountryRepository>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CountryService, { provide: CountryRepository, useValue: repo }],
    }).compile();
    service = module.get<CountryService>(CountryService);
  });

  it('sorts by displayOrder ascending and uses name as the tiebreaker', async () => {
    repo.findCached.mockResolvedValueOnce([
      buildCountry({ id: 4, symbol: 'FR', name: 'France', displayOrder: 4 }),
      buildCountry({ id: 99, symbol: 'AT', name: 'Austria', displayOrder: 999 }),
      buildCountry({ id: 1, symbol: 'CH', name: 'Switzerland', displayOrder: 1 }),
      buildCountry({ id: 100, symbol: 'BE', name: 'Belgium', displayOrder: 999 }),
      buildCountry({ id: 2, symbol: 'DE', name: 'Germany', displayOrder: 2 }),
      buildCountry({ id: 3, symbol: 'IT', name: 'Italy', displayOrder: 3 }),
    ]);

    const result = await service.getAllCountry();

    // CH/DE/IT/FR come first (priority order), then alphabetic within 999.
    expect(result.map((c) => c.symbol)).toEqual(['CH', 'DE', 'IT', 'FR', 'AT', 'BE']);
  });

  it('does not mutate the cached repository array', async () => {
    const cached = [
      buildCountry({ symbol: 'CH', name: 'Switzerland', displayOrder: 1 }),
      buildCountry({ symbol: 'AT', name: 'Austria', displayOrder: 999 }),
    ];
    repo.findCached.mockResolvedValueOnce(cached);

    await service.getAllCountry();

    // Original cached array preserved in insertion order.
    expect(cached.map((c) => c.symbol)).toEqual(['CH', 'AT']);
  });
});
