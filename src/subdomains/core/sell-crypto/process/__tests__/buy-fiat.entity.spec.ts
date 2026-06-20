import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { createCustomFiatOutput } from 'src/subdomains/supporting/fiat-output/__mocks__/fiat-output.entity.mock';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { createCustomSell } from '../../route/__mocks__/sell.entity.mock';
import { createCustomBuyFiat } from '../__mocks__/buy-fiat.entity.mock';

function bankOf(name: IbanBankName): Bank {
  return Object.assign(new Bank(), { name });
}

// payout-bank asset: dexName = fiat currency, bank.name = payout bank
function bankAsset(currency: string, bankName: IbanBankName): Asset {
  return createCustomAsset({ id: 100, dexName: currency, bank: bankOf(bankName) });
}

describe('BuyFiat entity', () => {
  describe('pendingOutputAmount', () => {
    it('keeps the Yapeal CHF liability counted while transmitted but not yet settled (THE FIX)', () => {
      const asset = bankAsset('CHF', IbanBankName.YAPEAL);
      const buyFiat = createCustomBuyFiat({
        outputAmount: 9911.89,
        sell: createCustomSell({ fiat: createCustomFiat({ name: 'CHF' }) }),
        fiatOutput: createCustomFiatOutput({
          bank: bankOf(IbanBankName.YAPEAL),
          isTransmittedDate: new Date(),
          outputDate: null,
        }),
      });

      expect(buyFiat.pendingOutputAmount(asset)).toEqual(9911.89);
    });

    it('still counts the liability at entity level even when outputDate is also set (removal is via getPendingTransactions)', () => {
      const asset = bankAsset('CHF', IbanBankName.YAPEAL);
      const buyFiat = createCustomBuyFiat({
        outputAmount: 9911.89,
        sell: createCustomSell({ fiat: createCustomFiat({ name: 'CHF' }) }),
        fiatOutput: createCustomFiatOutput({
          bank: bankOf(IbanBankName.YAPEAL),
          isTransmittedDate: new Date(),
          outputDate: new Date(),
        }),
      });

      expect(buyFiat.pendingOutputAmount(asset)).toEqual(9911.89);
    });

    it('keeps the Olky EUR liability counted while transmitted but not yet settled (regression-lock, unchanged)', () => {
      const asset = bankAsset('EUR', IbanBankName.OLKY);
      const buyFiat = createCustomBuyFiat({
        outputAmount: 5000,
        sell: createCustomSell({ fiat: createCustomFiat({ name: 'EUR' }) }),
        fiatOutput: createCustomFiatOutput({
          bank: bankOf(IbanBankName.OLKY),
          isTransmittedDate: new Date(),
          outputDate: null,
        }),
      });

      expect(buyFiat.pendingOutputAmount(asset)).toEqual(5000);
    });

    it('returns 0 when fiatOutput is null even with outputAmount set (no Yapeal fallback default)', () => {
      const asset = bankAsset('CHF', IbanBankName.YAPEAL);
      const buyFiat = createCustomBuyFiat({
        outputAmount: 9911.89,
        sell: createCustomSell({ fiat: createCustomFiat({ name: 'CHF' }) }),
        fiatOutput: null,
      });

      expect(buyFiat.pendingOutputAmount(asset)).toEqual(0);
    });
  });

  describe('pendingInputAmount', () => {
    it('counts inputAmount on the crypto asset when outputAmount is not yet priced', () => {
      const cryptoAsset = createCustomAsset({ id: 200, dexName: 'BTC' });
      const buyFiat = createCustomBuyFiat({
        inputAmount: 0.5,
        outputAmount: null,
        cryptoInput: createCustomCryptoInput({ asset: cryptoAsset }),
      });

      expect(buyFiat.pendingInputAmount(cryptoAsset)).toEqual(0.5);
    });

    it('keeps inputAmount on the crypto asset while output is priced but no payout bank is routed yet (no-fiatOutput window)', () => {
      const cryptoAsset = createCustomAsset({ id: 200, dexName: 'BTC' });
      const buyFiat = createCustomBuyFiat({
        inputAmount: 0.5,
        outputAmount: 9911.89,
        fiatOutput: null,
        cryptoInput: createCustomCryptoInput({ asset: cryptoAsset }),
      });

      expect(buyFiat.pendingInputAmount(cryptoAsset)).toEqual(0.5);
    });

    it('returns 0 once output is priced and the payout bank is routed (handoff to pendingOutputAmount complete)', () => {
      const cryptoAsset = createCustomAsset({ id: 200, dexName: 'BTC' });
      const buyFiat = createCustomBuyFiat({
        inputAmount: 0.5,
        outputAmount: 9911.89,
        cryptoInput: createCustomCryptoInput({ asset: cryptoAsset }),
        fiatOutput: createCustomFiatOutput({ bank: bankOf(IbanBankName.YAPEAL), isTransmittedDate: new Date() }),
      });

      expect(buyFiat.pendingInputAmount(cryptoAsset)).toEqual(0);
    });
  });
});
