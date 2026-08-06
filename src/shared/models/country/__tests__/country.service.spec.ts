import { EntityManager, Equal } from 'typeorm';
import { createDefaultCountry } from '../__mocks__/country.entity.mock';
import { CountryRepository } from '../country.repository';
import { CountryService } from '../country.service';

describe('CountryService', () => {
  let repo: CountryRepository;
  let service: CountryService;
  let findOneBy: jest.SpyInstance;

  beforeEach(() => {
    // A real CountryRepository, so the lookup goes through the CachedRepository's AsyncCache —
    // the empty-key rejection this guards against lives there, not in the service.
    repo = new CountryRepository({} as EntityManager);
    findOneBy = jest.spyOn(repo, 'findOneBy').mockResolvedValue(createDefaultCountry());
    service = new CountryService(repo);
  });

  describe('getCountryWithSymbol', () => {
    it('should resolve a two-letter symbol against the symbol column', async () => {
      await service.getCountryWithSymbol('DE');

      expect(findOneBy).toHaveBeenCalledWith({ symbol: Equal('DE') });
    });

    it('should resolve a three-letter symbol against the symbol3 column', async () => {
      await service.getCountryWithSymbol('DEU');

      expect(findOneBy).toHaveBeenCalledWith({ symbol3: Equal('DEU') });
    });

    // geoip-lite2 answers with country '' for IPv6 ranges it holds a record for but no country.
    // That empty string reached AsyncCache as an empty key, which throws, and IpCountryGuard runs
    // on every auth route — so an affected client could not sign in or sign up at all.
    it('should return undefined for an empty symbol instead of throwing', async () => {
      await expect(service.getCountryWithSymbol('')).resolves.toBeUndefined();

      expect(findOneBy).not.toHaveBeenCalled();
    });

    it('should return undefined for a nullish symbol instead of querying', async () => {
      await expect(service.getCountryWithSymbol(undefined)).resolves.toBeUndefined();

      expect(findOneBy).not.toHaveBeenCalled();
    });
  });
});
