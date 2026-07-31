import { ConfigService } from 'src/config/config';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionDirection } from 'src/subdomains/supporting/payment/entities/transaction-specification.entity';
import { Country } from '../../country/country.entity';
import { CountryService } from '../../country/country.service';
import { createCustomFiat } from '../__mocks__/fiat.entity.mock';
import { FiatController } from '../fiat.controller';
import { FiatService } from '../fiat.service';

describe('FiatController', () => {
  let controller: FiatController;
  let fiatService: { getAllFiat: jest.Mock };
  let countryService: { getAllCountry: jest.Mock };
  let findCachedMock: jest.Mock;
  let findMock: jest.Mock;
  let getSpecForMock: jest.Mock;
  let repos: RepositoryFactory;

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    findCachedMock = jest.fn().mockResolvedValue([]);
    findMock = jest.fn().mockResolvedValue([]);
    getSpecForMock = jest.fn().mockReturnValue({ minVolume: 1, minFee: 0 });

    // RepositoryFactory is a concrete class whose nested repositories are plain instance properties —
    // build only the surface getAllFiat() actually touches.
    repos = {
      transactionSpecification: {
        findCached: findCachedMock,
        find: findMock,
        getSpecFor: getSpecForMock,
      },
    } as unknown as RepositoryFactory;

    fiatService = {
      getAllFiat: jest.fn().mockResolvedValue([]),
    };
    countryService = {
      getAllCountry: jest.fn().mockResolvedValue([]),
    };

    controller = new FiatController(
      fiatService as unknown as FiatService,
      repos,
      countryService as unknown as CountryService,
    );
  });

  describe('getAllFiat', () => {
    it('loads transaction specifications via findCached and never via find', async () => {
      await controller.getAllFiat();

      expect(findCachedMock).toHaveBeenCalledWith('all');
      expect(findMock).not.toHaveBeenCalled();
    });

    it('composes detail DTOs from fiat, specs and countries via FiatDtoMapper', async () => {
      // approxPriceChf = 1 keeps convert() arithmetic exact (no rounding edge cases).
      const fiat = createCustomFiat({
        id: 42,
        name: 'CHF',
        buyable: true,
        sellable: true,
        cardBuyable: false,
        cardSellable: false,
        instantBuyable: false,
        instantSellable: false,
        approxPriceChf: 1,
      });
      const specs = [{ system: 'Fiat', asset: 'CHF', direction: TransactionDirection.IN, minVolume: 10, minFee: 0 }];
      const spec = { minVolume: 10, minFee: 0 };
      const countries = [
        Object.assign(new Country(), { symbol: 'CH', dfxEnable: true }),
        Object.assign(new Country(), { symbol: 'DE', dfxEnable: true }),
        Object.assign(new Country(), { symbol: 'US', dfxEnable: false }),
      ];

      findCachedMock.mockResolvedValue(specs);
      getSpecForMock.mockReturnValue(spec);
      fiatService.getAllFiat.mockResolvedValue([fiat]);
      countryService.getAllCountry.mockResolvedValue(countries);

      const result = await controller.getAllFiat();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(42);
      expect(result[0].name).toBe('CHF');
      expect(result[0].buyable).toBe(true);
      expect(result[0].sellable).toBe(true);
      // minVolume 10 CHF / approxPriceChf 1 → 10; max from Config.tradingLimits.yearlyDefault
      expect(result[0].limits[FiatPaymentMethod.BANK].minVolume).toBe(10);
      expect(result[0].limits[FiatPaymentMethod.BANK].maxVolume).toBe(1_000_000_000);
      expect(result[0].limits[FiatPaymentMethod.INSTANT].minVolume).toBe(0);
      expect(result[0].limits[FiatPaymentMethod.INSTANT].maxVolume).toBe(0);
      expect(result[0].limits[FiatPaymentMethod.CARD].minVolume).toBe(0);
      expect(result[0].limits[FiatPaymentMethod.CARD].maxVolume).toBe(0);
      // buyable + dfxEnable countries with default isIbanCountryAllowed → CH, DE (not US)
      expect(result[0].allowedIbanCountries).toEqual(['CH', 'DE']);
      expect(getSpecForMock).toHaveBeenCalledWith(specs, fiat, TransactionDirection.IN);
    });
  });
});
