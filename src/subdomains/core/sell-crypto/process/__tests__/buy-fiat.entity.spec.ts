import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { createCustomSell } from 'src/subdomains/core/sell-crypto/route/__mocks__/sell.entity.mock';
import { createCustomBank, olkyEUR, yapealCHF } from 'src/subdomains/supporting/bank/bank/__mocks__/bank.entity.mock';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { createCustomFiatOutput } from 'src/subdomains/supporting/fiat-output/__mocks__/fiat-output.entity.mock';
import { createCustomBuyFiat } from '../__mocks__/buy-fiat.entity.mock';

describe('BuyFiat', () => {
  describe('pendingOutputAmount', () => {
    const chfYapealAsset = createCustomAsset({ name: 'CHF', dexName: 'CHF', bank: yapealCHF });
    const eurOlkyAsset = createCustomAsset({ name: 'EUR', dexName: 'EUR', bank: olkyEUR });

    it('counts the output as liability while transmitted but not yet completed (Yapeal)', () => {
      const buyFiat = createCustomBuyFiat({
        outputAmount: 14980.12,
        sell: createCustomSell({ fiat: createCustomFiat({ name: 'CHF' }) }),
        fiatOutput: createCustomFiatOutput({
          bank: createCustomBank({ name: IbanBankName.YAPEAL, currency: 'CHF' }),
          isTransmittedDate: new Date(),
        }),
      });

      expect(buyFiat.pendingOutputAmount(chfYapealAsset)).toEqual(14980.12);
    });

    it('counts the output under the payout bank asset only', () => {
      const buyFiat = createCustomBuyFiat({
        outputAmount: 100,
        sell: createCustomSell({ fiat: createCustomFiat({ name: 'EUR' }) }),
        fiatOutput: createCustomFiatOutput({ bank: olkyEUR, isTransmittedDate: new Date() }),
      });

      expect(buyFiat.pendingOutputAmount(eurOlkyAsset)).toEqual(100);
      expect(buyFiat.pendingOutputAmount(chfYapealAsset)).toEqual(0);
    });

    it('defaults to Yapeal when no fiat output exists yet', () => {
      const buyFiat = createCustomBuyFiat({
        outputAmount: 50,
        sell: createCustomSell({ fiat: createCustomFiat({ name: 'CHF' }) }),
        fiatOutput: undefined,
      });

      expect(buyFiat.pendingOutputAmount(chfYapealAsset)).toEqual(50);
      expect(buyFiat.pendingOutputAmount(eurOlkyAsset)).toEqual(0);
    });

    it('returns 0 before the output amount is set', () => {
      const buyFiat = createCustomBuyFiat({
        outputAmount: undefined,
        sell: createCustomSell({ fiat: createCustomFiat({ name: 'CHF' }) }),
      });

      expect(buyFiat.pendingOutputAmount(chfYapealAsset)).toEqual(0);
    });
  });
});
