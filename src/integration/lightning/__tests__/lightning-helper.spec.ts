import { Test } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { LightningAddressType, LightningHelper } from '../lightning-helper';

describe('LightningHelper', () => {
  beforeAll(async () => {
    const config = {
      url: () => 'https://test.dfx.api:12345/v0.1',
    };

    await Test.createTestingModule({
      providers: [TestUtil.provideConfig(config)],
    }).compile();
  });

  describe('Convert', () => {
    it('btcToSat', () => {
      expect(LightningHelper.btcToSat(1)).toEqual(100000000);
      expect(LightningHelper.btcToSat(0.00000001)).toEqual(1);
    });

    it('satToMsat', () => {
      expect(LightningHelper.satToMsat(1)).toEqual(1000);
      expect(LightningHelper.satToMsat(0.001)).toEqual(1);
    });

    it('btcToMsat', () => {
      expect(LightningHelper.btcToMsat(1)).toEqual(100000000000);
      expect(LightningHelper.btcToMsat(0.00000000001)).toEqual(1);
    });

    it('msatToSat', () => {
      expect(LightningHelper.msatToSat(1000)).toEqual(1);
      expect(LightningHelper.msatToSat(1)).toEqual(0.001);
    });

    it('satToBtc', () => {
      expect(LightningHelper.satToBtc(1)).toEqual(0.00000001);
      expect(LightningHelper.satToBtc(100000000)).toEqual(1);
    });

    it('msatToBtc', () => {
      expect(LightningHelper.msatToBtc(1)).toEqual(0.00000000001);
      expect(LightningHelper.msatToBtc(100000000000)).toEqual(1);
    });
  });

  describe('Adresses', () => {
    it('addressToLnurlp', () => {
      const lnurl = LightningHelper.addressToLnurlp('address@domainname.area');

      expect(LightningHelper.decodeLnurl(lnurl)).toEqual('https://domainname.area/.well-known/lnurlp/address');
    });

    it('getAddressType', () => {
      expect(LightningHelper.getAddressType('LNURLxxxxx')).toEqual(LightningAddressType.LN_URL);
      expect(LightningHelper.getAddressType('LNNIDyyyyy')).toEqual(LightningAddressType.LN_NID);
      expect(LightningHelper.getAddressType('LNDHUBzzzzz')).toEqual(LightningAddressType.LND_HUB);

      expect(() => LightningHelper.getAddressType('ABCxxxxx')).toThrowError(
        'Cannot detect Lightning Address Type of address ABCxxxxx',
      );
    });
  });

  describe('LNURL', () => {
    it('createEncodedLnurlp', () => {
      const encodedLnurl = LightningHelper.createEncodedLnurlp('ABC12345');
      const decodedLnurl = LightningHelper.decodeLnurl(encodedLnurl);

      expect(decodedLnurl).toEqual('https://test.dfx.api:12345/v0.1/lnurlp/ABC12345');
    });

    it('createEncodedLnurlw', () => {
      const encodedLnurl = LightningHelper.createEncodedLnurlw('ABC12345');
      const decodedLnurl = LightningHelper.decodeLnurl(encodedLnurl);

      expect(decodedLnurl).toEqual('https://test.dfx.api:12345/v0.1/lnurlw/ABC12345');
    });
  });

  describe('Signature', () => {
    it('getPublicKeyOfSignature', () => {
      const message = 'This is a test message';
      const signature =
        'rba9bxndwfzfa89r61bzhdfzby349pgmsi8p7ikd5zxwwanonted6skrkeyrk7sf3ncptexhkukif3wc1xyek7zp7p1ikqjboum6zht1';

      const publicKey = LightningHelper.getPublicKeyOfSignature(message, signature);

      expect(publicKey).toEqual('02badf8a069960c1be9e3c0e949b1926af060e2cd1da557f38210ae9c355db3bd5');
    });

    it('verifySignature', () => {
      const message = 'This is a test message';
      const signature =
        'rba9bxndwfzfa89r61bzhdfzby349pgmsi8p7ikd5zxwwanonted6skrkeyrk7sf3ncptexhkukif3wc1xyek7zp7p1ikqjboum6zht1';
      const publicKey = '02badf8a069960c1be9e3c0e949b1926af060e2cd1da557f38210ae9c355db3bd5';

      const isValid = LightningHelper.verifySignature(message, signature, publicKey);
      expect(isValid).toEqual(true);

      expect(LightningHelper.verifySignature(message.replace(/e$/, 'i'), signature, publicKey)).toEqual(false);
      expect(LightningHelper.verifySignature(message, signature.replace(/1$/, '2'), publicKey)).toEqual(false);
      expect(LightningHelper.verifySignature(message, signature, publicKey.replace(/5$/, '4'))).toEqual(false);
    });
  });
});
