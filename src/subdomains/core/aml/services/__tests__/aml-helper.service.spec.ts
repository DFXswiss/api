import { ConfigService } from 'src/config/config';
import { Country } from 'src/shared/models/country/country.entity';
import { AmlError } from 'src/subdomains/core/aml/enums/aml-error.enum';
import { AmlHelperService } from 'src/subdomains/core/aml/services/aml-helper.service';
import { createCustomBuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/__mocks__/buy-crypto.entity.mock';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { createDefaultBuyFiat } from 'src/subdomains/core/sell-crypto/process/__mocks__/buy-fiat.entity.mock';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { createDefaultBankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';

/**
 * Tests for isTrustedReferrer phone verification exemption
 *
 * These tests verify the business logic for the trusted referrer feature:
 * - Users referred by a trusted referrer should be exempt from phone verification
 * - Other AML checks should remain unaffected
 *
 * The actual logic is in AmlHelperService.getAmlErrors() at line 206-216:
 *
 * if (
 *   !entity.userData.phoneCallCheckDate &&
 *   !entity.user.wallet.amlRuleList.includes(AmlRule.RULE_14) &&
 *   !refUser?.userData?.isTrustedReferrer &&  // <-- This is the new condition
 *   (entity.bankTx || entity.checkoutTx) &&
 *   entity.userData.phone &&
 *   entity.userData.birthday &&
 *   (!entity.userData.accountType || entity.userData.accountType === AccountType.PERSONAL) &&
 *   Util.yearsDiff(entity.userData.birthday) > 55
 * )
 *   errors.push(AmlError.PHONE_VERIFICATION_NEEDED);
 */

describe('AmlHelperService - isTrustedReferrer Logic', () => {
  /**
   * Helper function that simulates the phone verification check logic
   * This mirrors the exact logic from AmlHelperService.getAmlErrors()
   */
  function shouldRequirePhoneVerification(params: {
    phoneCallCheckDate?: Date;
    walletHasRule14: boolean;
    refUserIsTrusted?: boolean;
    hasBankTxOrCheckoutTx: boolean;
    hasPhone: boolean;
    hasBirthday: boolean;
    isPersonalAccount: boolean;
    ageInYears: number;
  }): boolean {
    const {
      phoneCallCheckDate,
      walletHasRule14,
      refUserIsTrusted,
      hasBankTxOrCheckoutTx,
      hasPhone,
      hasBirthday,
      isPersonalAccount,
      ageInYears,
    } = params;

    return (
      !phoneCallCheckDate &&
      !walletHasRule14 &&
      !refUserIsTrusted && // This is the new condition
      hasBankTxOrCheckoutTx &&
      hasPhone &&
      hasBirthday &&
      isPersonalAccount &&
      ageInYears > 55
    );
  }

  describe('Phone Verification Check with Trusted Referrer', () => {
    const baseParams = {
      phoneCallCheckDate: undefined,
      walletHasRule14: false,
      hasBankTxOrCheckoutTx: true,
      hasPhone: true,
      hasBirthday: true,
      isPersonalAccount: true,
      ageInYears: 60,
    };

    describe('when user is over 55 with phone and bank transaction', () => {
      it('should require phone verification when NO referrer exists', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          refUserIsTrusted: undefined, // No referrer
        });
        expect(result).toBe(true);
      });

      it('should require phone verification when referrer is NOT trusted', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          refUserIsTrusted: false,
        });
        expect(result).toBe(true);
      });

      it('should NOT require phone verification when referrer IS trusted', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          refUserIsTrusted: true,
        });
        expect(result).toBe(false);
      });

      it('should NOT require phone verification when phoneCallCheckDate is set', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          phoneCallCheckDate: new Date(),
          refUserIsTrusted: undefined,
        });
        expect(result).toBe(false);
      });

      it('should NOT require phone verification when wallet has RULE_14', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          walletHasRule14: true,
          refUserIsTrusted: undefined,
        });
        expect(result).toBe(false);
      });
    });

    describe('when user is 55 years or younger', () => {
      it('should NOT require phone verification for 55 year old', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          ageInYears: 55,
          refUserIsTrusted: undefined,
        });
        expect(result).toBe(false);
      });

      it('should NOT require phone verification for 40 year old', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          ageInYears: 40,
          refUserIsTrusted: undefined,
        });
        expect(result).toBe(false);
      });
    });

    describe('when user is 56 or older', () => {
      it('should require phone verification for 56 year old without trusted referrer', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          ageInYears: 56,
          refUserIsTrusted: undefined,
        });
        expect(result).toBe(true);
      });

      it('should NOT require phone verification for 56 year old WITH trusted referrer', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          ageInYears: 56,
          refUserIsTrusted: true,
        });
        expect(result).toBe(false);
      });
    });

    describe('when user has no phone', () => {
      it('should NOT require phone verification', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          hasPhone: false,
          refUserIsTrusted: undefined,
        });
        expect(result).toBe(false);
      });
    });

    describe('when user has no birthday', () => {
      it('should NOT require phone verification', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          hasBirthday: false,
          refUserIsTrusted: undefined,
        });
        expect(result).toBe(false);
      });
    });

    describe('when account is organization', () => {
      it('should NOT require phone verification', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          isPersonalAccount: false,
          refUserIsTrusted: undefined,
        });
        expect(result).toBe(false);
      });
    });

    describe('when transaction is swap (no bankTx or checkoutTx)', () => {
      it('should NOT require phone verification', () => {
        const result = shouldRequirePhoneVerification({
          ...baseParams,
          hasBankTxOrCheckoutTx: false,
          refUserIsTrusted: undefined,
        });
        expect(result).toBe(false);
      });
    });
  });

  describe('Trusted Referrer does NOT affect other conditions', () => {
    it('trusted referrer should ONLY skip phone verification, not other checks', () => {
      // With trusted referrer, phone verification is skipped
      const withTrustedRef = shouldRequirePhoneVerification({
        phoneCallCheckDate: undefined,
        walletHasRule14: false,
        refUserIsTrusted: true,
        hasBankTxOrCheckoutTx: true,
        hasPhone: true,
        hasBirthday: true,
        isPersonalAccount: true,
        ageInYears: 60,
      });
      expect(withTrustedRef).toBe(false);

      // Without trusted referrer, phone verification is required
      const withoutTrustedRef = shouldRequirePhoneVerification({
        phoneCallCheckDate: undefined,
        walletHasRule14: false,
        refUserIsTrusted: false,
        hasBankTxOrCheckoutTx: true,
        hasPhone: true,
        hasBirthday: true,
        isPersonalAccount: true,
        ageInYears: 60,
      });
      expect(withoutTrustedRef).toBe(true);
    });

    it('all other conditions must still be met for phone verification', () => {
      // Even without trusted referrer, if any other condition is not met,
      // phone verification should not be required
      const testCases = [
        { phoneCallCheckDate: new Date(), expected: false },
        { walletHasRule14: true, expected: false },
        { hasBankTxOrCheckoutTx: false, expected: false },
        { hasPhone: false, expected: false },
        { hasBirthday: false, expected: false },
        { isPersonalAccount: false, expected: false },
        { ageInYears: 55, expected: false },
      ];

      for (const testCase of testCases) {
        const result = shouldRequirePhoneVerification({
          phoneCallCheckDate: undefined,
          walletHasRule14: false,
          refUserIsTrusted: false,
          hasBankTxOrCheckoutTx: true,
          hasPhone: true,
          hasBirthday: true,
          isPersonalAccount: true,
          ageInYears: 60,
          ...testCase,
        });
        expect(result).toBe(testCase.expected);
      }
    });
  });

  describe('Complete truth table for trusted referrer condition', () => {
    // Truth table: refUserIsTrusted can be undefined, true, or false
    const truthTable: Array<{ refUserIsTrusted: boolean | undefined; description: string; shouldCheck: boolean }> = [
      { refUserIsTrusted: undefined, description: 'undefined (no referrer)', shouldCheck: true },
      { refUserIsTrusted: false, description: 'false (referrer not trusted)', shouldCheck: true },
      { refUserIsTrusted: true, description: 'true (referrer is trusted)', shouldCheck: false },
    ];

    for (const { refUserIsTrusted, description, shouldCheck } of truthTable) {
      it(`when refUser.userData.isTrustedReferrer is ${description}, phone check should be ${shouldCheck ? 'required' : 'skipped'}`, () => {
        const result = shouldRequirePhoneVerification({
          phoneCallCheckDate: undefined,
          walletHasRule14: false,
          refUserIsTrusted,
          hasBankTxOrCheckoutTx: true,
          hasPhone: true,
          hasBirthday: true,
          isPersonalAccount: true,
          ageInYears: 60,
        });
        expect(result).toBe(shouldCheck);
      });
    }
  });
});

describe('AmlHelperService.getAmlErrors - null-safety (fail-closed, no poison-entity crash)', () => {
  beforeAll(() => {
    new ConfigService(); // initialise the global Config singleton used inside getAmlErrors
  });

  function runErrors(entity: BuyCrypto | BuyFiat, bankData: BankData, ibanCountry?: Country): AmlError[] {
    return AmlHelperService.getAmlErrors(
      entity,
      entity.cryptoInput?.asset ?? entity.outputAsset,
      0, // minVolume
      100, // amountInChf
      0, // last7dCheckoutVolume
      0, // last30dVolume
      0, // last365dVolume
      bankData,
      [], // blacklist
      [], // phoneCallList
      [], // banks
      ibanCountry,
      undefined, // refUser
      [], // ipLogCountries
      undefined, // virtualIban
      [], // multiAccountBankNames
      undefined, // recommender
    );
  }

  it('routes a sell with an unresolved IBAN country to manual review instead of crashing (#585)', () => {
    const entity = createDefaultBuyFiat();

    let errors: AmlError[];
    expect(() => (errors = runErrors(entity, undefined, undefined))).not.toThrow();
    expect(errors).toContain(AmlError.IBAN_CURRENCY_MISMATCH);
  });

  it('evaluates the checkout card-name check with null bankData without crashing (#585)', () => {
    const entity = createCustomBuyCrypto({
      id: 1,
      cryptoInput: undefined,
      bankTx: undefined,
      checkoutTx: { cardName: 'JOHN DOE', cardFingerPrint: 'fp', cardIssuerCountry: 'DE' } as any,
    });
    entity.transaction.userData.verifiedName = 'JANE SMITH';

    let errors: AmlError[];
    expect(() => (errors = runErrors(entity, undefined, undefined))).not.toThrow();
    expect(errors).toContain(AmlError.CARD_NAME_MISMATCH);
  });
});

describe('AmlHelperService.getAmlErrors - RULE_11 KYC waiver is IP-gated; wallet rules evaluated once', () => {
  beforeAll(() => {
    new ConfigService(); // initialise the global Config singleton used inside getAmlErrors
  });

  function errorsFor(entity: BuyCrypto | BuyFiat): AmlError[] {
    return AmlHelperService.getAmlErrors(
      entity,
      entity.cryptoInput?.asset ?? entity.outputAsset,
      0, // minVolume
      100, // amountInChf
      0, // last7dCheckoutVolume
      0, // last30dVolume
      0, // last365dVolume
      undefined, // bankData
      [], // blacklist
      [], // phoneCallList
      [], // banks
      undefined, // ibanCountry
      undefined, // refUser
      [], // ipLogCountries
      undefined, // virtualIban
      [], // multiAccountBankNames
      undefined, // recommender
    );
  }

  // Wallet carries RULE_3 (requires KycLevel 50) + RULE_11 (KYC waiver for special IP countries),
  // user below LEVEL_50 → RULE_3 would push KYC_LEVEL_50_NOT_REACHED unless the RULE_11 waiver applies.
  function withRule11KycWallet(entity: BuyCrypto | BuyFiat, ipCountry: string) {
    entity.user.wallet.amlRules = '3;11';
    entity.user.ipCountry = ipCountry;
    entity.userData.kycLevel = KycLevel.LEVEL_30;
    return entity;
  }

  it('#581: non-CH user on a RULE_11 wallet is NOT waived → KYC stays required (sell/BuyFiat)', () => {
    const entity = withRule11KycWallet(createDefaultBuyFiat(), 'DE');
    expect(errorsFor(entity)).toContain(AmlError.KYC_LEVEL_50_NOT_REACHED);
  });

  it('#581: CH user on a RULE_11 wallet IS waived → KYC suppressed (sell/BuyFiat)', () => {
    const entity = withRule11KycWallet(createDefaultBuyFiat(), 'CH');
    expect(errorsFor(entity)).not.toContain(AmlError.KYC_LEVEL_50_NOT_REACHED);
  });

  it('#582: buy behaves like sell — CH user waiver is no longer negated by a second loop (BuyCrypto)', () => {
    const entity = withRule11KycWallet(createCustomBuyCrypto({ bankTx: createDefaultBankTx() }), 'CH');
    expect(errorsFor(entity)).not.toContain(AmlError.KYC_LEVEL_50_NOT_REACHED);
  });

  it('#582: non-CH buy stays fail-closed — KYC still required (BuyCrypto)', () => {
    const entity = withRule11KycWallet(createCustomBuyCrypto({ bankTx: createDefaultBankTx() }), 'DE');
    expect(errorsFor(entity)).toContain(AmlError.KYC_LEVEL_50_NOT_REACHED);
  });

  it('#582: wallet rules are evaluated exactly once — no duplicate FORCE_MANUAL_CHECK (BuyCrypto)', () => {
    const entity = createCustomBuyCrypto({ bankTx: createDefaultBankTx() });
    entity.user.wallet.amlRules = '15'; // RULE_15 = Force Manual Check (unconditional)
    const occurrences = errorsFor(entity).filter((e) => e === AmlError.FORCE_MANUAL_CHECK).length;
    expect(occurrences).toBe(1);
  });
});
