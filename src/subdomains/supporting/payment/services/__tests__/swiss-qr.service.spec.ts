import { createMock } from '@golevelup/ts-jest';
import { I18nService } from 'nestjs-i18n';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BankInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { SwissQRService } from '../swiss-qr.service';

const frickBankInfo: BankInfoDto = {
  name: 'DFX AG',
  bank: 'Bank Frick',
  street: 'Bahnhofstrasse',
  number: '7',
  zip: '6300',
  city: 'Zug',
  country: 'Schweiz',
  countryCode: 'CH',
  iban: 'LI5908811V08ZBXGZT1A3',
  bic: 'BFRILI22XXX',
  sepaInstant: false,
};

describe('SwissQRService', () => {
  let service: SwissQRService;

  beforeEach(() => {
    service = new SwissQRService(createMock<AssetService>(), createMock<I18nService>());
  });

  describe('getCreditor', () => {
    // The previous code derived the country from the IBAN prefix, which stamped DFX's Swiss
    // address as "LI" once deposits moved to Bank Frick.
    it('uses address countryCode CH for Bank Frick LI IBAN (not IBAN prefix)', () => {
      const creditor = service['getCreditor'](frickBankInfo);

      expect(creditor.country).toBe('CH');
      expect(creditor.account).toBe(frickBankInfo.iban);
      expect(creditor.name).toBe(frickBankInfo.name);
      expect(creditor.address).toBe(frickBankInfo.street);
      expect(creditor.zip).toBe(frickBankInfo.zip);
      expect(creditor.city).toBe(frickBankInfo.city);
      expect(creditor.buildingNumber).toBe(frickBankInfo.number);
    });

    it('fails closed when countryCode is missing', () => {
      const withoutCountryCode = { ...frickBankInfo, countryCode: undefined } as BankInfoDto;

      expect(() => service['getCreditor'](withoutCountryCode)).toThrow(
        'Missing creditor address country code',
      );
    });

    it('omits buildingNumber when number is undefined and sets it when present', () => {
      const withoutNumber = { ...frickBankInfo, number: undefined };
      const withNumber = { ...frickBankInfo, number: '7' };

      expect(service['getCreditor'](withoutNumber)).not.toHaveProperty('buildingNumber');
      expect(service['getCreditor'](withNumber).buildingNumber).toBe('7');
    });
  });

  describe('createQrCode', () => {
    it('accepts LI account with CH creditor address', () => {
      const qr = service.createQrCode(100, 'CHF', 'ref', frickBankInfo);

      expect(typeof qr).toBe('string');
      expect(qr.length).toBeGreaterThan(0);
    });
  });
});
