import GeoIp from 'geoip-lite2';
import { GeoLocationService } from '../geo-location.service';

describe('GeoLocationService', () => {
  let service: GeoLocationService;

  beforeEach(() => {
    service = new GeoLocationService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getCountry', () => {
    it('should return the country of a located IP', () => {
      jest.spyOn(GeoIp, 'lookup').mockReturnValue({ country: 'DE' } as ReturnType<typeof GeoIp.lookup>);

      expect(service.getCountry('1.2.3.4')).toEqual('DE');
    });

    it('should return undefined when the IP has no record', () => {
      jest.spyOn(GeoIp, 'lookup').mockReturnValue(null);

      expect(service.getCountry('fe80::1')).toBeUndefined();
    });

    // Some IPv6 ranges have a record carrying an empty country. Reported verbatim it reached the
    // country lookup as an empty cache key and 500'd every auth route, and it would persist to
    // ip_log.country as '' where an unlocated IP persists null.
    it('should return undefined when the record carries an empty country', () => {
      jest.spyOn(GeoIp, 'lookup').mockReturnValue({ country: '' } as ReturnType<typeof GeoIp.lookup>);

      expect(service.getCountry('2606:4700:4700::1111')).toBeUndefined();
    });
  });
});
