import { Test } from '@nestjs/testing';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { TestUtil } from 'src/shared/utils/test.util';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { ScorechainOutcome } from 'src/subdomains/core/aml/enums/scorechain-outcome.enum';
import { AmlHelperService } from 'src/subdomains/core/aml/services/aml-helper.service';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { ChargebackBlockReason } from 'src/subdomains/generic/support/dto/user-data-support.dto';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { KycStatus, RiskStatus, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { createCustomFiatOutput } from 'src/subdomains/supporting/fiat-output/__mocks__/fiat-output.entity.mock';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { createCustomTransaction } from 'src/subdomains/supporting/payment/__mocks__/transaction.entity.mock';
import { createCustomSell } from '../../route/__mocks__/sell.entity.mock';
import { createCustomBuyFiat } from '../__mocks__/buy-fiat.entity.mock';
import { BuyFiat } from '../buy-fiat.entity';

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

    const run = (entity: any, screen?: () => Promise<ScorechainOutcome>) =>
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
      const screen = jest.fn().mockResolvedValue(ScorechainOutcome.HIGH_RISK);

      await run(createCustomBuyFiat({}), screen);

      expect(screen).not.toHaveBeenCalled();
      expect(AmlHelperService.getAmlResult).toHaveBeenCalledTimes(1);
    });

    it('screens when the tx would otherwise pass and flips to PENDING on a high-risk hit', async () => {
      const spy = jest
        .spyOn(AmlHelperService, 'getAmlResult')
        .mockReturnValueOnce({ amlCheck: CheckStatus.PASS } as any)
        .mockReturnValueOnce({ amlCheck: CheckStatus.PENDING, amlReason: AmlReason.MANUAL_CHECK } as any);
      const screen = jest.fn().mockResolvedValue(ScorechainOutcome.HIGH_RISK);
      const entity = createCustomBuyFiat({});

      await run(entity, screen);

      expect(screen).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[0].at(-1)).toBe(ScorechainOutcome.PASS); // phase 1
      expect(spy.mock.calls[1].at(-1)).toBe(ScorechainOutcome.HIGH_RISK); // phase 2
      expect(entity.amlCheck).toBe(CheckStatus.PENDING);
    });

    it('keeps PASS when the tx would pass and screening is clean (no phase 2)', async () => {
      jest.spyOn(AmlHelperService, 'getAmlResult').mockReturnValue({ amlCheck: CheckStatus.PASS } as any);
      const screen = jest.fn().mockResolvedValue(ScorechainOutcome.PASS);
      const entity = createCustomBuyFiat({});

      await run(entity, screen);

      expect(screen).toHaveBeenCalledTimes(1);
      expect(AmlHelperService.getAmlResult).toHaveBeenCalledTimes(1);
      expect(entity.amlCheck).toBe(CheckStatus.PASS);
    });

    it('screens when the tx would otherwise pass and flips to PENDING when the provider is unavailable', async () => {
      const spy = jest
        .spyOn(AmlHelperService, 'getAmlResult')
        .mockReturnValueOnce({ amlCheck: CheckStatus.PASS } as any)
        .mockReturnValueOnce({ amlCheck: CheckStatus.PENDING, amlReason: AmlReason.MANUAL_CHECK } as any);
      const screen = jest.fn().mockResolvedValue(ScorechainOutcome.UNAVAILABLE);
      const entity = createCustomBuyFiat({});

      await run(entity, screen);

      expect(screen).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[1].at(-1)).toBe(ScorechainOutcome.UNAVAILABLE);
      expect(entity.amlCheck).toBe(CheckStatus.PENDING);
    });
  });

  describe('#resetAmlCheck()', () => {
    it('clears amlPostProcessed so the reset verdict is re-processed once it is re-evaluated', () => {
      const entity = createCustomBuyFiat({ amlPostProcessed: true });

      const [, update] = entity.resetAmlCheck();

      expect(update.amlPostProcessed).toBe(false);
      expect(entity.amlPostProcessed).toBe(false);
    });
  });

  describe('#getChargebackBlockReasons()', () => {
    function releasedUserData(overrides: Parameters<typeof createCustomUserData>[0] = {}) {
      return createCustomUserData({
        kycStatus: KycStatus.COMPLETED,
        status: UserDataStatus.ACTIVE,
        riskStatus: RiskStatus.NA,
        verifiedName: 'Max Mustermann',
        firstname: 'Max',
        surname: 'Mustermann',
        ...overrides,
      });
    }

    function pendingBuyFiat(overrides: Partial<BuyFiat> = {}): BuyFiat {
      return createCustomBuyFiat({
        chargebackAllowedDate: undefined,
        chargebackDate: undefined,
        isComplete: false,
        chargebackTxId: undefined,
        chargebackAmount: 100,
        chargebackAddress: 'bc1qexample',
        chargebackAsset: 'BTC',
        transaction: createCustomTransaction({
          userData: releasedUserData(),
          user: createCustomUser({ status: UserStatus.ACTIVE }),
        }),
        ...overrides,
      });
    }

    it('returns empty array when all auto-promotion conditions are met', () => {
      expect(pendingBuyFiat().getChargebackBlockReasons()).toEqual([]);
    });

    it('returns MISSING_CHARGEBACK_AMOUNT when chargebackAmount is missing', () => {
      const entity = pendingBuyFiat({ chargebackAmount: undefined });
      expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.MISSING_CHARGEBACK_AMOUNT]);
    });

    it('returns USER_NOT_RELEASED when userData is blocked', () => {
      const entity = pendingBuyFiat({
        transaction: createCustomTransaction({
          userData: releasedUserData({ status: UserDataStatus.BLOCKED }),
          user: createCustomUser({ status: UserStatus.ACTIVE }),
        }),
      });
      expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.USER_NOT_RELEASED]);
    });

    it('returns USER_NOT_RELEASED when kycStatus CHECK (not allowed for BuyFiat)', () => {
      const entity = pendingBuyFiat({
        transaction: createCustomTransaction({
          userData: releasedUserData({ kycStatus: KycStatus.CHECK }),
          user: createCustomUser({ status: UserStatus.ACTIVE }),
        }),
      });
      expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.USER_NOT_RELEASED]);
    });

    it('returns USER_NOT_RELEASED when user status is not active', () => {
      const entity = pendingBuyFiat({
        transaction: createCustomTransaction({
          userData: releasedUserData(),
          user: createCustomUser({ status: UserStatus.BLOCKED }),
        }),
      });
      expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.USER_NOT_RELEASED]);
    });

    it('returns MISSING_CHARGEBACK_TARGET when chargebackAddress is missing', () => {
      const entity = pendingBuyFiat({ chargebackAddress: undefined });
      expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.MISSING_CHARGEBACK_TARGET]);
    });

    it('returns multiple reasons when several conditions fail', () => {
      const entity = pendingBuyFiat({
        chargebackAmount: undefined,
        chargebackAddress: undefined,
        transaction: createCustomTransaction({
          userData: releasedUserData({ status: UserDataStatus.BLOCKED }),
          user: createCustomUser({ status: UserStatus.ACTIVE }),
        }),
      });
      expect(entity.getChargebackBlockReasons()).toEqual([
        ChargebackBlockReason.MISSING_CHARGEBACK_AMOUNT,
        ChargebackBlockReason.USER_NOT_RELEASED,
        ChargebackBlockReason.MISSING_CHARGEBACK_TARGET,
      ]);
    });

    it('fail-closed: returns empty array when chargebackAllowedDate is set even if other reasons apply', () => {
      const entity = pendingBuyFiat({
        chargebackAllowedDate: new Date(),
        chargebackAmount: undefined,
        chargebackAddress: undefined,
        transaction: createCustomTransaction({
          userData: releasedUserData({ status: UserDataStatus.BLOCKED }),
          user: createCustomUser({ status: UserStatus.ACTIVE }),
        }),
      });
      expect(entity.getChargebackBlockReasons()).toEqual([]);
    });

    it('fail-closed: returns empty array when chargebackDate is set', () => {
      const entity = pendingBuyFiat({ chargebackDate: new Date(), chargebackAmount: undefined });
      expect(entity.getChargebackBlockReasons()).toEqual([]);
    });

    it('fail-closed: returns empty array when isComplete is true', () => {
      const entity = pendingBuyFiat({ isComplete: true, chargebackAmount: undefined });
      expect(entity.getChargebackBlockReasons()).toEqual([]);
    });

    it('fail-closed: returns empty array when chargebackTxId is set', () => {
      const entity = pendingBuyFiat({ chargebackTxId: 'tx-123', chargebackAmount: undefined });
      expect(entity.getChargebackBlockReasons()).toEqual([]);
    });
  });
});
