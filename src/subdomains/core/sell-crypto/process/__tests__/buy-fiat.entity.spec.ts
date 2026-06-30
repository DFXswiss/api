import { Test } from '@nestjs/testing';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { TestUtil } from 'src/shared/utils/test.util';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { AmlHelperService } from 'src/subdomains/core/aml/services/aml-helper.service';
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

  describe('#amlCheckAndFillUp Scorechain gate', () => {
    beforeAll(async () => {
      await Test.createTestingModule({ providers: [TestUtil.provideConfig()] }).compile();
    });
    afterEach(() => jest.restoreAllMocks());

    const run = (entity: any, screen?: () => Promise<boolean>) =>
      entity.amlCheckAndFillUp(
        null, // inputAsset
        0, // minVolume
        100, // amountInEur
        120, // amountInChf
        0, // last30dVolume
        0, // last365dVolume
        null, // bankData
        [], // blacklist
        [], // phoneCallList
        null, // ibanCountry
        undefined, // refUser
        undefined, // recommender
        screen,
      );

    it('does not screen when the tx would not otherwise pass', async () => {
      jest.spyOn(AmlHelperService, 'getAmlResult').mockReturnValue({ amlCheck: CheckStatus.FAIL } as any);
      const screen = jest.fn().mockResolvedValue(true);

      await run(createCustomBuyFiat({}), screen);

      expect(screen).not.toHaveBeenCalled();
      expect(AmlHelperService.getAmlResult).toHaveBeenCalledTimes(1);
    });

    it('screens when the tx would otherwise pass and flips to PENDING on a high-risk hit', async () => {
      const spy = jest
        .spyOn(AmlHelperService, 'getAmlResult')
        .mockReturnValueOnce({ amlCheck: CheckStatus.PASS } as any)
        .mockReturnValueOnce({ amlCheck: CheckStatus.PENDING, amlReason: AmlReason.MANUAL_CHECK } as any);
      const screen = jest.fn().mockResolvedValue(true);
      const entity = createCustomBuyFiat({});

      await run(entity, screen);

      expect(screen).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[0].at(-1)).toBe(false); // phase 1
      expect(spy.mock.calls[1].at(-1)).toBe(true); // phase 2
      expect(entity.amlCheck).toBe(CheckStatus.PENDING);
    });

    it('keeps PASS when the tx would pass and screening is clean (no phase 2)', async () => {
      jest.spyOn(AmlHelperService, 'getAmlResult').mockReturnValue({ amlCheck: CheckStatus.PASS } as any);
      const screen = jest.fn().mockResolvedValue(false);
      const entity = createCustomBuyFiat({});

      await run(entity, screen);

      expect(screen).toHaveBeenCalledTimes(1);
      expect(AmlHelperService.getAmlResult).toHaveBeenCalledTimes(1);
      expect(entity.amlCheck).toBe(CheckStatus.PASS);
    });
  });
});
