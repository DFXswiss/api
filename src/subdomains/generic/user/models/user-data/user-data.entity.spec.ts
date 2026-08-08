import { NotFoundException } from '@nestjs/common';
import { Config, ConfigService } from 'src/config/config';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { createDefaultCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { createDefaultLanguage } from 'src/shared/models/language/__mocks__/language.entity.mock';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { DefaultPaymentLinkConfig } from 'src/subdomains/core/payment-link/entities/payment-link.config';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { KycStepType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { getMetadataArgsStorage } from 'typeorm';
import { AccountOpenerAuthorization, Organization } from '../organization/organization.entity';
import { createCustomUser } from '../user/__mocks__/user.entity.mock';
import { UpdateUserDto } from '../user/dto/update-user.dto';
import { User } from '../user/user.entity';
import { UserStatus } from '../user/user.enum';
import { AccountType } from './account-type.enum';
import { createCustomUserData } from './__mocks__/user-data.entity.mock';
import { Blank, KycCompleted, UserData } from './user-data.entity';
import {
  BlankType,
  KycLevel,
  KycStatus,
  KycType,
  LimitPeriod,
  PhoneCallPreferredTime,
  PhoneCallStatus,
  RiskStatus,
  ServiceProvider,
  SignatoryPower,
  UserDataStatus,
} from './user-data.enum';

describe('UserData', () => {
  // `Config` is an `export let` the ConfigService constructor assigns; several getters below read
  // from it (kycUrl, the trading limits, both validity windows), so it must exist before they run.
  beforeAll(() => {
    new ConfigService();
  });

  // getMailLoginUser resolves which user a mail login authenticates as for an elevated role. It is the
  // security-critical core of the mail-login staff-role feature (see AuthService.completeSignInByMail).
  describe('getMailLoginUser', () => {
    // priority-ordered staff whitelist, mirrors MailLoginStaffRoles in auth.service.ts
    const STAFF_ROLES = [UserRole.COMPLIANCE, UserRole.SUPPORT, UserRole.REALUNIT];

    const user = (role: UserRole, overrides: Partial<User> = {}): User => createCustomUser({ role, ...overrides });
    const resolve = (users?: User[]): User | undefined => createCustomUserData({ users }).getMailLoginUser(STAFF_ROLES);

    it('returns undefined for a regular account (only USER wallets)', () => {
      expect(resolve([user(UserRole.USER, { id: 1 }), user(UserRole.USER, { id: 2 })])).toBeUndefined();
    });

    it('returns the staff user for a support account', () => {
      const support = user(UserRole.SUPPORT, { id: 7 });
      expect(resolve([user(UserRole.USER, { id: 1 }), support])).toBe(support);
    });

    it('elevates a realunit account', () => {
      const realunit = user(UserRole.REALUNIT, { id: 5 });
      expect(resolve([realunit])).toBe(realunit);
    });

    it('prefers the higher-privileged role: COMPLIANCE over SUPPORT', () => {
      const compliance = user(UserRole.COMPLIANCE, { id: 2 });
      const support = user(UserRole.SUPPORT, { id: 3 });
      expect(resolve([support, compliance])).toBe(compliance);
    });

    it('prefers the higher-privileged role: SUPPORT over REALUNIT', () => {
      const support = user(UserRole.SUPPORT, { id: 3 });
      const realunit = user(UserRole.REALUNIT, { id: 4 });
      expect(resolve([realunit, support])).toBe(support);
    });

    it('never elevates a role outside the whitelist (ADMIN/SUPER_ADMIN/MARKETING)', () => {
      const users = [
        user(UserRole.ADMIN, { id: 1 }),
        user(UserRole.SUPER_ADMIN, { id: 2 }),
        user(UserRole.MARKETING, { id: 3 }),
      ];
      expect(resolve(users)).toBeUndefined();
    });

    it('skips a blocked staff user', () => {
      expect(resolve([user(UserRole.SUPPORT, { id: 3, status: UserStatus.BLOCKED })])).toBeUndefined();
    });

    it('skips a deleted staff user', () => {
      expect(resolve([user(UserRole.SUPPORT, { id: 3, status: UserStatus.DELETED })])).toBeUndefined();
    });

    it('skips a blocked staff user but elevates an active one', () => {
      const compliance = user(UserRole.COMPLIANCE, { id: 9 });
      const blockedSupport = user(UserRole.SUPPORT, { id: 3, status: UserStatus.BLOCKED });
      expect(resolve([blockedSupport, compliance])).toBe(compliance);
    });

    it('skips a staff user without a wallet (token generation would dereference user.wallet)', () => {
      expect(resolve([user(UserRole.SUPPORT, { id: 3, wallet: undefined })])).toBeUndefined();
    });

    it('returns undefined for an empty users list', () => {
      expect(resolve([])).toBeUndefined();
    });

    it('returns undefined when the users relation is not loaded', () => {
      expect(resolve(undefined)).toBeUndefined();
    });
  });

  // isStaff drives the TOTP-only 2FA enforcement: any account carrying a staff role must use an app factor
  // (see TfaService.setup/checkVerification). It uses hasRole, so — unlike getMailLoginUser — it does not
  // filter blocked users: an account that holds a staff role stays fail-closed onto TOTP.
  describe('isStaff', () => {
    const isStaff = (users?: User[]): boolean => createCustomUserData({ users }).isStaff;

    it('is true for a support account', () => {
      expect(isStaff([createCustomUser({ role: UserRole.USER }), createCustomUser({ role: UserRole.SUPPORT })])).toBe(
        true,
      );
    });

    it('is true for a compliance account', () => {
      expect(isStaff([createCustomUser({ role: UserRole.COMPLIANCE })])).toBe(true);
    });

    it('is true for a realunit account', () => {
      expect(isStaff([createCustomUser({ role: UserRole.REALUNIT })])).toBe(true);
    });

    it('is false for a regular account', () => {
      expect(isStaff([createCustomUser({ role: UserRole.USER })])).toBe(false);
    });

    it('is false for an admin/marketing account (not a staff role)', () => {
      expect(
        isStaff([createCustomUser({ role: UserRole.ADMIN }), createCustomUser({ role: UserRole.MARKETING })]),
      ).toBe(false);
    });

    it('is fail-closed: true even for a blocked staff user', () => {
      expect(isStaff([createCustomUser({ role: UserRole.SUPPORT, status: UserStatus.BLOCKED })])).toBe(true);
    });

    it('is false when the users relation is not loaded', () => {
      expect(isStaff(undefined)).toBe(false);
    });
  });

  // serviceProviders is the additive RealUnit customer marker ("add-on on top" of the DFX core). It must
  // never influence DFX core logic; only the RealUnit dashboards read it. These tests pin the additive,
  // idempotent, merge-safe semantics the scope service and the merge union rely on.
  describe('serviceProviders (RealUnit customer add-on)', () => {
    const userData = (serviceProviders?: string): UserData => createCustomUserData({ serviceProviders });

    it('serviceProviderList is empty when unset', () => {
      expect(userData(undefined).serviceProviderList).toEqual([]);
    });

    it('isRealUnitCustomer is false for a plain DFX account', () => {
      expect(userData(undefined).isRealUnitCustomer).toBe(false);
    });

    it('isRealUnitCustomer is true when the RealUnit marker is present', () => {
      expect(userData('RealUnit').isRealUnitCustomer).toBe(true);
    });

    it('isRealUnitCustomer is false for a merged tombstone even when the marker is present', () => {
      const ud = createCustomUserData({ serviceProviders: 'RealUnit', status: UserDataStatus.MERGED });
      expect(ud.isRealUnitCustomer).toBe(false);
    });

    it('addServiceProvider sets the marker on an account that had none', () => {
      const ud = userData(undefined);
      ud.addServiceProvider(ServiceProvider.REALUNIT);
      expect(ud.serviceProviders).toBe('RealUnit');
      expect(ud.isRealUnitCustomer).toBe(true);
    });

    it('addServiceProvider is idempotent — no duplicate token', () => {
      const ud = userData('RealUnit');
      ud.addServiceProvider(ServiceProvider.REALUNIT);
      expect(ud.serviceProviders).toBe('RealUnit');
    });

    it('addServiceProvider returns an UpdateResult tuple [id, update]', () => {
      const ud = createCustomUserData({ id: 42, serviceProviders: undefined });
      const [id, update] = ud.addServiceProvider(ServiceProvider.REALUNIT);
      expect(id).toBe(42);
      expect(update).toEqual({ serviceProviders: 'RealUnit' });
    });
  });

  describe('entity update methods', () => {
    it('sendMail copies the account mail into the black squad fields', () => {
      const ud = createCustomUserData({ id: 42, mail: 'a@b.ch' });

      const [id, update] = ud.sendMail();

      expect(id).toBe(42);
      expect(update.blackSquadRecipientMail).toBe('a@b.ch');
      expect(update.blackSquadMailSendDate).toBeInstanceOf(Date);
    });

    it.each([
      [SignatoryPower.SINGLE, AccountOpenerAuthorization.SINGLE_SIGNATURE],
      [SignatoryPower.DOUBLE, AccountOpenerAuthorization.AUTHORIZATION],
      [SignatoryPower.NONE, AccountOpenerAuthorization.AUTHORIZATION],
    ])('setAccountOpenerAuthorization maps %s to %s', (power, expected) => {
      const ud = createCustomUserData({});

      const [, update] = ud.setAccountOpenerAuthorization(power);

      expect(update.accountOpenerAuthorization).toBe(expected);
      expect(ud.accountOpenerAuthorization).toBe(expected);
    });

    // Deactivation caps the level rather than clearing it: an account that was identified stays
    // identified, but must not keep a level that grants trading.
    it('deactivateUserData caps the kyc level at LEVEL_20 and stamps the date', () => {
      const ud = createCustomUserData({ kycLevel: KycLevel.LEVEL_50 });

      const [, update] = ud.deactivateUserData();

      expect(update.status).toBe(UserDataStatus.DEACTIVATED);
      expect(update.kycLevel).toBe(KycLevel.LEVEL_20);
      expect(update.deactivationDate).toBeInstanceOf(Date);
    });

    it('deactivateUserData leaves a level below the cap untouched', () => {
      const ud = createCustomUserData({ kycLevel: KycLevel.LEVEL_10 });

      expect(ud.deactivateUserData()[1].kycLevel).toBe(KycLevel.LEVEL_10);
    });

    it.each([
      ['KYC_ONLY for an account with no wallets', [], UserDataStatus.KYC_ONLY],
      ['ACTIVE when any wallet is active', [UserStatus.NA, UserStatus.ACTIVE], UserDataStatus.ACTIVE],
      ['NA when wallets exist but none is active', [UserStatus.NA], UserDataStatus.NA],
    ])('reactivateUserData returns %s', (_label, statuses, expected) => {
      const ud = createCustomUserData({ users: statuses.map((status) => createCustomUser({ status })) });

      expect(ud.reactivateUserData()).toEqual({ status: expected, deactivationDate: null });
    });

    it('addFee starts a new list and appends to an existing one', () => {
      expect(createCustomUserData({ individualFees: undefined }).addFee(1)[1].individualFees).toBe('1');
      expect(createCustomUserData({ individualFees: '1' }).addFee(2)[1].individualFees).toBe('1;2');
    });

    it('removeFee drops the id and keeps the rest', () => {
      expect(createCustomUserData({ individualFees: '1;2;3' }).removeFee(2)[1].individualFees).toBe('1;3');
    });

    it('addKycClient starts a new list and appends to an existing one', () => {
      expect(createCustomUserData({ kycClients: undefined }).addKycClient(4)[1].kycClients).toBe('4');
      expect(createCustomUserData({ kycClients: '4' }).addKycClient(5)[1].kycClients).toBe('4;5');
    });

    it('removeKycClient drops the id and keeps the rest', () => {
      expect(createCustomUserData({ kycClients: '4;5;6' }).removeKycClient(5)[1].kycClients).toBe('4;6');
    });

    it('refreshLastCheckedTimestamp stamps the name check date', () => {
      const [, update] = createCustomUserData({}).refreshLastCheckedTimestamp();

      expect(update.lastNameCheckDate).toBeInstanceOf(Date);
    });

    it('setVerifiedName assigns the name', () => {
      const ud = createCustomUserData({});

      expect(ud.setVerifiedName('Jane Doe')[1]).toEqual({ verifiedName: 'Jane Doe' });
      expect(ud.verifiedName).toBe('Jane Doe');
    });

    it('setKycStatusCheck moves the kyc status to CHECK', () => {
      const ud = createCustomUserData({});

      expect(ud.setKycStatusCheck()[1]).toEqual({ kycStatus: KycStatus.CHECK });
      expect(ud.kycStatus).toBe(KycStatus.CHECK);
    });
  });

  describe('setUserDataSettings', () => {
    it('keeps the current language and currency when the dto omits them', () => {
      const language = createDefaultLanguage();
      const currency = { id: 9 } as Fiat;
      const ud = createCustomUserData({ language, currency });

      const [, update] = ud.setUserDataSettings({});

      expect(update.language).toBe(language);
      expect(update.currency).toBe(currency);
      expect(update.phoneCallTimes).toBeUndefined();
    });

    it('joins the preferred phone times', () => {
      const [, update] = createCustomUserData({}).setUserDataSettings({
        preferredPhoneTimes: [PhoneCallPreferredTime.H_9_TO_10, PhoneCallPreferredTime.H_15_TO_16],
      } as UpdateUserDto);

      expect(update.phoneCallTimes).toBe(`${PhoneCallPreferredTime.H_9_TO_10};${PhoneCallPreferredTime.H_15_TO_16}`);
    });

    // A rejection is only recorded when the account had no prior verdict or was merely unavailable —
    // it must not overwrite a status compliance set deliberately.
    it.each([undefined, PhoneCallStatus.UNAVAILABLE])(
      'records USER_REJECTED when acceptCall is false and the prior status is %p',
      (phoneCallStatus) => {
        const ud = createCustomUserData({ phoneCallStatus });

        expect(ud.setUserDataSettings({ acceptCall: false } as UpdateUserDto)[1].phoneCallStatus).toBe(
          PhoneCallStatus.USER_REJECTED,
        );
      },
    );

    it('does not overwrite an existing non-unavailable phone call status', () => {
      const ud = createCustomUserData({ phoneCallStatus: PhoneCallStatus.COMPLETED });

      expect(ud.setUserDataSettings({ acceptCall: false } as UpdateUserDto)[1].phoneCallStatus).toBeUndefined();
    });

    it('does not record a rejection when acceptCall is true', () => {
      const ud = createCustomUserData({ phoneCallStatus: undefined });

      const [, update] = ud.setUserDataSettings({ acceptCall: true } as UpdateUserDto);

      expect(update.phoneCallStatus).toBeUndefined();
      expect(update.phoneCallAccepted).toBe(true);
    });
  });

  describe('phone call helpers', () => {
    it('phoneCallTimesObject splits the stored list and answers empty when unset', () => {
      expect(createCustomUserData({ phoneCallTimes: 'Morning;Evening' }).phoneCallTimesObject).toEqual([
        'Morning',
        'Evening',
      ]);
      expect(createCustomUserData({ phoneCallTimes: undefined }).phoneCallTimesObject).toEqual([]);
    });

    it('phoneCallExternalAccountCheckValuesObject splits the stored list, undefined when unset', () => {
      expect(
        createCustomUserData({ phoneCallExternalAccountCheckValues: 'a;b' }).phoneCallExternalAccountCheckValuesObject,
      ).toEqual(['a', 'b']);
      expect(
        createCustomUserData({ phoneCallExternalAccountCheckValues: undefined })
          .phoneCallExternalAccountCheckValuesObject,
      ).toBeUndefined();
    });

    it('addPhoneCallExternalAccountCheckValue appends, starts a list, and stays idempotent', () => {
      const fresh = createCustomUserData({ phoneCallExternalAccountCheckValues: undefined });
      fresh.addPhoneCallExternalAccountCheckValue('a');
      expect(fresh.phoneCallExternalAccountCheckValues).toBe('a');

      fresh.addPhoneCallExternalAccountCheckValue('b');
      expect(fresh.phoneCallExternalAccountCheckValues).toBe('a;b');

      fresh.addPhoneCallExternalAccountCheckValue('a');
      expect(fresh.phoneCallExternalAccountCheckValues).toBe('a;b');
    });
  });

  // Both date getters are bounded on both sides on purpose: a forward-dated value must count as no
  // check at all rather than as an unusually long one. See the comments on the getters.
  describe.each([
    ['hasValidNameCheckDate', 'lastNameCheckDate'],
    ['hasValidScorechainReview', 'scorechainCheckDate'],
  ])('%s', (getter, field) => {
    const withDate = (date?: Date) => createCustomUserData({ [field]: date }) as unknown as Record<string, boolean>;

    it('is false when the date is unset', () => {
      expect(withDate(undefined)[getter]).toBe(false);
    });

    it('is true for a recent check', () => {
      expect(withDate(Util.daysBefore(1))[getter]).toBe(true);
    });

    it('is false for a check far in the past', () => {
      expect(withDate(Util.daysBefore(100000))[getter]).toBe(false);
    });

    it('is false for a forward-dated check, which must not extend the window', () => {
      expect(withDate(Util.daysAfter(10))[getter]).toBe(false);
    });
  });

  describe('url getters', () => {
    it('builds the kyc and kyc video urls from the hash', () => {
      const ud = createCustomUserData({ kycHash: 'HASH' });

      expect(ud.kycUrl).toBe(`${Config.frontend.services}/kyc?code=HASH`);
      expect(ud.kycVideoUrl).toBe(`${Config.frontend.services}/kyc?code=HASH&step=ident/video`);
    });

    it('encodes the verified name into the dilisense url, undefined without one', () => {
      expect(createCustomUserData({ verifiedName: 'Jane Doe' }).dilisenseUrl).toBe(
        'https://dilisense.com/en/search/Jane%20Doe',
      );
      expect(createCustomUserData({ verifiedName: undefined }).dilisenseUrl).toBeUndefined();
    });
  });

  describe('list getters', () => {
    it('individualFeeList parses the list, undefined when unset', () => {
      expect(createCustomUserData({ individualFees: '1;2' }).individualFeeList).toEqual([1, 2]);
      expect(createCustomUserData({ individualFees: undefined }).individualFeeList).toBeUndefined();
    });

    it('kycClientList parses the list and falls back to empty', () => {
      expect(createCustomUserData({ kycClients: '3;4' }).kycClientList).toEqual([3, 4]);
      expect(createCustomUserData({ kycClients: undefined }).kycClientList).toEqual([]);
    });

    it('serviceProviderList parses the list and falls back to empty', () => {
      expect(createCustomUserData({ serviceProviders: 'RealUnit' }).serviceProviderList).toEqual([
        ServiceProvider.REALUNIT,
      ]);
      expect(createCustomUserData({ serviceProviders: undefined }).serviceProviderList).toEqual([]);
    });
  });

  describe('trading limit', () => {
    it('grants the yearly deposit limit from LEVEL_50, reduced by the volume already used', () => {
      const ud = createCustomUserData({
        kycLevel: KycLevel.LEVEL_50,
        depositLimit: 1000,
        annualBuyVolume: 100,
        annualSellVolume: 200,
        annualCryptoVolume: 300,
      });

      expect(ud.tradingLimit).toEqual({ limit: 1000, remaining: 400, period: LimitPeriod.YEAR });
      expect(ud.availableTradingLimit).toBe(400);
    });

    it('never reports a negative remaining limit', () => {
      const ud = createCustomUserData({
        kycLevel: KycLevel.LEVEL_50,
        depositLimit: 100,
        annualBuyVolume: 500,
        annualSellVolume: 0,
        annualCryptoVolume: 0,
      });

      expect(ud.tradingLimit.remaining).toBe(0);
    });

    it.each([KycLevel.REJECTED, KycLevel.TERMINATED])('grants nothing at kyc level %p', (kycLevel) => {
      const ud = createCustomUserData({ kycLevel });

      expect(ud.tradingLimit).toEqual({ limit: 0, period: LimitPeriod.MONTH });
      expect(ud.isKycTerminated).toBe(true);
      expect(ud.availableTradingLimit).toBe(0);
    });

    it('falls back to the monthly default below LEVEL_50', () => {
      const ud = createCustomUserData({ kycLevel: KycLevel.LEVEL_20 });

      expect(ud.tradingLimit).toEqual({
        limit: Config.tradingLimits.monthlyDefaultWoKyc,
        period: LimitPeriod.MONTH,
      });
      expect(ud.availableTradingLimit).toBe(Config.tradingLimits.monthlyDefaultWoKyc);
    });
  });

  describe('status getters', () => {
    it('kycLevelDisplay rounds down to the nearest ten', () => {
      expect(createCustomUserData({ kycLevel: 27 as KycLevel }).kycLevelDisplay).toBe(20);
    });

    it('isDfxUser reflects the kyc type', () => {
      expect(createCustomUserData({ kycType: KycType.DFX }).isDfxUser).toBe(true);
      expect(createCustomUserData({ kycType: KycType.LOCK }).isDfxUser).toBe(false);
    });

    it('completeName prefers the organization name and falls back to the natural person name', () => {
      expect(createCustomUserData({ organizationName: 'Acme AG', firstname: 'Jane' }).completeName).toBe('Acme AG');
      expect(createCustomUserData({ firstname: 'Jane', surname: 'Doe' }).completeName).toBe('Jane Doe');
    });

    it('naturalPersonName joins the parts present, undefined when both are missing', () => {
      expect(createCustomUserData({ firstname: 'Jane' }).naturalPersonName).toBe('Jane');
      expect(createCustomUserData({ surname: 'Doe' }).naturalPersonName).toBe('Doe');
      expect(createCustomUserData({}).naturalPersonName).toBeUndefined();
    });

    it('isBlocked covers both the status and a negative kyc level', () => {
      expect(createCustomUserData({ status: UserDataStatus.BLOCKED }).isBlocked).toBe(true);
      expect(createCustomUserData({ kycLevel: KycLevel.REJECTED }).isBlocked).toBe(true);
      expect(createCustomUserData({ status: UserDataStatus.ACTIVE, kycLevel: KycLevel.LEVEL_20 }).isBlocked).toBe(
        false,
      );
    });

    it('isDeactivated and isBlockedOrDeactivated', () => {
      expect(createCustomUserData({ status: UserDataStatus.DEACTIVATED }).isDeactivated).toBe(true);
      expect(createCustomUserData({ status: UserDataStatus.DEACTIVATED }).isBlockedOrDeactivated).toBe(true);
      expect(createCustomUserData({ status: UserDataStatus.BLOCKED }).isBlockedOrDeactivated).toBe(true);
      expect(
        createCustomUserData({ status: UserDataStatus.ACTIVE, kycLevel: KycLevel.LEVEL_20 }).isBlockedOrDeactivated,
      ).toBe(false);
    });

    it.each([RiskStatus.BLOCKED, RiskStatus.BLOCKED_BUY_CRYPTO, RiskStatus.BLOCKED_BUY_FIAT, RiskStatus.SUSPICIOUS])(
      'hasAnyRiskStatus is true for %s',
      (riskStatus) => {
        expect(createCustomUserData({ riskStatus }).hasAnyRiskStatus).toBe(true);
      },
    );

    it('hasAnyRiskStatus is false without a risk status', () => {
      expect(createCustomUserData({ riskStatus: undefined }).hasAnyRiskStatus).toBe(false);
    });

    it('reports the individual risk flags for their own status only', () => {
      expect(createCustomUserData({ riskStatus: RiskStatus.BLOCKED }).isRiskBlocked).toBe(true);
      expect(createCustomUserData({ riskStatus: RiskStatus.SUSPICIOUS }).isRiskBlocked).toBe(false);

      expect(createCustomUserData({ riskStatus: RiskStatus.BLOCKED_BUY_CRYPTO }).isRiskBuyCryptoBlocked).toBe(true);
      expect(createCustomUserData({ riskStatus: RiskStatus.BLOCKED }).isRiskBuyCryptoBlocked).toBe(false);

      expect(createCustomUserData({ riskStatus: RiskStatus.BLOCKED_BUY_FIAT }).isRiskBuyFiatBlocked).toBe(true);
      expect(createCustomUserData({ riskStatus: RiskStatus.BLOCKED }).isRiskBuyFiatBlocked).toBe(false);

      expect(createCustomUserData({ riskStatus: RiskStatus.SUSPICIOUS }).isSuspicious).toBe(true);
      expect(createCustomUserData({ riskStatus: RiskStatus.BLOCKED }).isSuspicious).toBe(false);
    });

    it('hasTradeHistory is true as soon as any volume is non-zero', () => {
      expect(createCustomUserData({ buyVolume: 0, sellVolume: 0, cryptoVolume: 0 }).hasTradeHistory).toBe(false);
      expect(createCustomUserData({ buyVolume: 1, sellVolume: 0, cryptoVolume: 0 }).hasTradeHistory).toBe(true);
      expect(createCustomUserData({ buyVolume: 0, sellVolume: 1, cryptoVolume: 0 }).hasTradeHistory).toBe(true);
      expect(createCustomUserData({ buyVolume: 0, sellVolume: 0, cryptoVolume: 1 }).hasTradeHistory).toBe(true);
    });

    it('hasActiveUser reflects whether any wallet is active', () => {
      expect(createCustomUserData({ users: [createCustomUser({ status: UserStatus.ACTIVE })] }).hasActiveUser).toBe(
        true,
      );
      expect(createCustomUserData({ users: [createCustomUser({ status: UserStatus.NA })] }).hasActiveUser).toBe(false);
    });

    it('hasBankTxVerification accepts every passing check status', () => {
      for (const bankTransactionVerification of [CheckStatus.PASS, CheckStatus.UNNECESSARY, CheckStatus.GSHEET]) {
        expect(createCustomUserData({ bankTransactionVerification }).hasBankTxVerification).toBe(true);
      }
      expect(createCustomUserData({ bankTransactionVerification: CheckStatus.FAIL }).hasBankTxVerification).toBe(false);
    });

    it('isPaymentStatusEnabled and isPaymentKycStatusEnabled', () => {
      expect(createCustomUserData({ status: UserDataStatus.ACTIVE }).isPaymentStatusEnabled).toBe(true);
      expect(createCustomUserData({ status: UserDataStatus.NA }).isPaymentStatusEnabled).toBe(true);
      expect(createCustomUserData({ status: UserDataStatus.BLOCKED }).isPaymentStatusEnabled).toBe(false);

      expect(createCustomUserData({ kycStatus: KycStatus.COMPLETED }).isPaymentKycStatusEnabled).toBe(true);
      expect(createCustomUserData({ kycStatus: KycStatus.NA }).isPaymentKycStatusEnabled).toBe(true);
      expect(createCustomUserData({ kycStatus: KycStatus.CHECK }).isPaymentKycStatusEnabled).toBe(false);
    });

    it('hasSuspiciousMail flags a local part with more than two digits', () => {
      expect(createCustomUserData({ mail: 'jane123@test.ch' }).hasSuspiciousMail).toBe(true);
      expect(createCustomUserData({ mail: 'jane12@test.ch' }).hasSuspiciousMail).toBe(false);
      expect(createCustomUserData({ mail: undefined }).hasSuspiciousMail).toBe(false);
    });

    it('isStaff is true only for a staff role', () => {
      expect(createCustomUserData({ users: [createCustomUser({ role: UserRole.SUPPORT })] }).isStaff).toBe(true);
      expect(createCustomUserData({ users: [createCustomUser({ role: UserRole.USER })] }).isStaff).toBe(false);
    });

    it('hasRole falls back to false when the users relation is not loaded', () => {
      expect(createCustomUserData({ users: undefined }).hasRole(UserRole.SUPPORT)).toBe(false);
    });
  });

  describe('address', () => {
    const organization = {
      street: 'Org Street',
      houseNumber: '1',
      location: 'Zug',
      zip: '6300',
      country: createDefaultCountry(),
    } as Organization;

    it.each([AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP])(
      'uses the organization address for %s',
      (accountType) => {
        const ud = createCustomUserData({ accountType, organization, street: 'Personal Street' });

        expect(ud.address).toEqual({
          street: 'Org Street',
          houseNumber: '1',
          city: 'Zug',
          zip: '6300',
          country: organization.country,
        });
      },
    );

    it('uses the personal address for a personal account', () => {
      const country = createDefaultCountry();
      const ud = createCustomUserData({
        accountType: AccountType.PERSONAL,
        street: 'Personal Street',
        houseNumber: '2',
        location: 'Bern',
        zip: '3000',
        country,
      });

      expect(ud.address).toEqual({
        street: 'Personal Street',
        houseNumber: '2',
        city: 'Bern',
        zip: '3000',
        country,
      });
    });
  });

  describe('paymentLinksConfigObj', () => {
    it('falls back to the defaults when nothing is stored', () => {
      expect(createCustomUserData({ paymentLinksConfig: undefined }).paymentLinksConfigObj).toEqual(
        DefaultPaymentLinkConfig,
      );
    });

    it('overlays the stored config onto the defaults', () => {
      const ud = createCustomUserData({ paymentLinksConfig: JSON.stringify({ minCompletionStatus: 'Completed' }) });

      expect(ud.paymentLinksConfigObj).toEqual({ ...DefaultPaymentLinkConfig, minCompletionStatus: 'Completed' });
    });
  });

  describe('kyc step lookups', () => {
    const step = (overrides: Partial<KycStep>): KycStep => Object.assign(new KycStep(), overrides);

    const pending = step({
      id: 1,
      name: KycStepName.PERSONAL_DATA,
      status: ReviewStatus.IN_PROGRESS,
      sequenceNumber: 1,
    });
    const completed = step({
      id: 2,
      name: KycStepName.PERSONAL_DATA,
      status: ReviewStatus.COMPLETED,
      sequenceNumber: 0,
    });
    const failed = step({ id: 3, name: KycStepName.IDENT, status: ReviewStatus.FAILED, sequenceNumber: 0 });

    const withSteps = (kycSteps?: KycStep[]) => createCustomUserData({ kycSteps });

    it('getStep finds by id and answers undefined otherwise', () => {
      expect(withSteps([pending]).getStep(1)).toBe(pending);
      expect(withSteps([pending]).getStep(99)).toBeUndefined();
      expect(withSteps(undefined).getStep(1)).toBeUndefined();
    });

    it('getStepOrThrow throws for an unknown id', () => {
      expect(withSteps([pending]).getStepOrThrow(1)).toBe(pending);
      expect(() => withSteps([pending]).getStepOrThrow(99)).toThrow(NotFoundException);
    });

    it('getStepsWith filters by name, type and sequence number', () => {
      const ud = withSteps([pending, completed, failed]);

      expect(ud.getStepsWith()).toHaveLength(3);
      expect(ud.getStepsWith(KycStepName.PERSONAL_DATA)).toEqual([pending, completed]);
      expect(ud.getStepsWith(KycStepName.PERSONAL_DATA, undefined, 1)).toEqual([pending]);
      expect(withSteps(undefined).getStepsWith()).toEqual([]);
    });

    it('getStepsWith filters by type', () => {
      const sumsub = step({ name: KycStepName.IDENT, type: KycStepType.SUMSUB_AUTO, sequenceNumber: 0 });
      const manual = step({ name: KycStepName.IDENT, type: KycStepType.MANUAL, sequenceNumber: 1 });

      expect(withSteps([sumsub, manual]).getStepsWith(KycStepName.IDENT, KycStepType.MANUAL)).toEqual([manual]);
    });

    it('getPendingStepWith, getCompletedStepWith and getNonFailedStepWith pick by status', () => {
      const ud = withSteps([pending, completed, failed]);

      expect(ud.getPendingStepWith(KycStepName.PERSONAL_DATA)).toBe(pending);
      expect(ud.getCompletedStepWith(KycStepName.PERSONAL_DATA)).toBe(completed);
      expect(ud.getNonFailedStepWith(KycStepName.IDENT)).toBeUndefined();
      expect(ud.getNonFailedStepWith(KycStepName.PERSONAL_DATA)).toBe(pending);
    });

    it('getPendingStepOrThrow requires a pending step of the given name', () => {
      const ud = withSteps([pending, completed]);

      expect(ud.getPendingStepOrThrow(1, KycStepName.PERSONAL_DATA)).toBe(pending);
      expect(() => ud.getPendingStepOrThrow(2)).toThrow(NotFoundException);
      expect(() => ud.getPendingStepOrThrow(1, KycStepName.IDENT)).toThrow(NotFoundException);
      expect(() => ud.getPendingStepOrThrow(99)).toThrow(NotFoundException);
    });

    it('hasStepsInProgress reflects any pending step', () => {
      expect(withSteps([pending]).hasStepsInProgress).toBe(true);
      expect(withSteps([completed]).hasStepsInProgress).toBe(false);
      expect(withSteps(undefined).hasStepsInProgress).toBe(false);
    });

    it('hasCompletedStep and hasDoneStep', () => {
      const inReview = step({ name: KycStepName.IDENT, status: ReviewStatus.FINISHED, sequenceNumber: 1 });
      const ud = withSteps([completed, inReview]);

      expect(ud.hasCompletedStep(KycStepName.PERSONAL_DATA)).toBe(true);
      expect(ud.hasCompletedStep(KycStepName.IDENT)).toBe(false);
      expect(ud.hasDoneStep(KycStepName.IDENT)).toBe(true);
    });

    it('getNextSequenceNumber starts at 0 and continues past the highest existing attempt', () => {
      expect(withSteps([]).getNextSequenceNumber(KycStepName.PERSONAL_DATA)).toBe(0);
      expect(withSteps([pending, completed]).getNextSequenceNumber(KycStepName.PERSONAL_DATA)).toBe(2);
    });

    // A sumsub attempt must not reuse the sequence number of the deprecated non-sumsub type it
    // replaced, or the unique index on (userData, name, type, sequenceNumber) would still collide
    // after a type migration.
    it('getNextSequenceNumber also considers the deprecated type of a sumsub step', () => {
      const legacy = step({ name: KycStepName.IDENT, type: KycStepType.VIDEO, sequenceNumber: 5 });

      expect(withSteps([legacy]).getNextSequenceNumber(KycStepName.IDENT, KycStepType.SUMSUB_VIDEO)).toBe(6);
    });

    it.each([
      [KycStepType.SUMSUB_AUTO, KycStepType.AUTO],
      [KycStepType.SUMSUB_VIDEO, KycStepType.VIDEO],
      [KycStepType.MANUAL, undefined],
      [undefined, undefined],
    ])('getDeprecatedStepTypes maps %p to %p', (type, expected) => {
      expect(createCustomUserData({}).getDeprecatedStepTypes(type)).toBe(expected);
    });
  });

  describe('merge preconditions', () => {
    const account = (overrides: Partial<UserData> = {}) =>
      createCustomUserData({
        kycType: KycType.DFX,
        status: UserDataStatus.ACTIVE,
        kycLevel: KycLevel.LEVEL_20,
        users: [],
        ...overrides,
      });

    it('accepts a mergeable pair', () => {
      expect(account().isMergePossibleWith(account())).toBe(true);
      expect(() => account().checkIfMergePossibleWith(account())).not.toThrow();
    });

    it('rejects a non-DFX master', () => {
      expect(() => account({ kycType: KycType.LOCK }).checkIfMergePossibleWith(account())).toThrow('Invalid KYC type');
    });

    it.each(['master', 'slave'])('rejects a compliance account on the %s side', (side) => {
      const compliance = { users: [createCustomUser({ role: UserRole.COMPLIANCE })] };
      const master = account(side === 'master' ? compliance : {});
      const slave = account(side === 'slave' ? compliance : {});

      expect(() => master.checkIfMergePossibleWith(slave)).toThrow('Cannot merge compliance accounts');
    });

    it('rejects when both sides are on the AML list', () => {
      const onList = { amlListAddedDate: new Date() };

      expect(() => account(onList).checkIfMergePossibleWith(account(onList))).toThrow(
        'Slave and master are on AML list',
      );
    });

    it.each(['master', 'slave'])('rejects an already merged %s', (side) => {
      const merged = { status: UserDataStatus.MERGED };
      const master = account(side === 'master' ? merged : {});
      const slave = account(side === 'slave' ? merged : {});

      expect(() => master.checkIfMergePossibleWith(slave)).toThrow('Master or slave is already merged');
    });

    it('rejects a verified name mismatch but allows the same name', () => {
      expect(() =>
        account({ verifiedName: 'Jane Doe' }).checkIfMergePossibleWith(account({ verifiedName: 'John Roe' })),
      ).toThrow('Verified name mismatch');

      expect(() =>
        account({ verifiedName: 'Jane Doe' }).checkIfMergePossibleWith(account({ verifiedName: 'Jane Doe' })),
      ).not.toThrow();
    });

    it.each(['master', 'slave'])('rejects a blocked %s', (side) => {
      const blocked = { status: UserDataStatus.BLOCKED };
      const master = account(side === 'master' ? blocked : {});
      const slave = account(side === 'slave' ? blocked : {});

      expect(() => master.checkIfMergePossibleWith(slave)).toThrow('Master or slave is blocked');
    });

    // Below LEVEL_20 the slave carries no reviewed account type yet, so a mismatch is harmless.
    it('rejects an account type mismatch only once the slave reached LEVEL_20', () => {
      const master = account({ accountType: AccountType.PERSONAL });

      expect(() =>
        master.checkIfMergePossibleWith(
          account({ accountType: AccountType.ORGANIZATION, kycLevel: KycLevel.LEVEL_20 }),
        ),
      ).toThrow('Account type mismatch');

      expect(() =>
        master.checkIfMergePossibleWith(
          account({ accountType: AccountType.ORGANIZATION, kycLevel: KycLevel.LEVEL_10 }),
        ),
      ).not.toThrow();
    });

    it('isMergePossibleWith converts every rejection into false', () => {
      expect(account({ kycType: KycType.LOCK }).isMergePossibleWith(account())).toBe(false);
    });
  });

  describe('required fields', () => {
    const complete = {
      accountType: AccountType.PERSONAL,
      mail: 'a@b.ch',
      phone: '+41791234567',
      firstname: 'Jane',
      surname: 'Doe',
      street: 'Street',
      location: 'Zug',
      zip: '6300',
      country: createDefaultCountry(),
    };

    it('requires only personal fields for a personal account', () => {
      const ud = createCustomUserData({ accountType: AccountType.PERSONAL });

      expect(ud.requiredKycFields).not.toContain('organizationName');
      expect(ud.isPersonalAccount).toBe(true);
    });

    it('treats a missing account type as personal', () => {
      expect(createCustomUserData({ accountType: undefined }).isPersonalAccount).toBe(true);
    });

    it('additionally requires the organization fields for an organization', () => {
      const ud = createCustomUserData({ accountType: AccountType.ORGANIZATION });

      expect(ud.requiredKycFields).toEqual(expect.arrayContaining(['organizationName', 'organizationCountry']));
      expect(ud.isPersonalAccount).toBe(false);
    });

    it('isDataComplete requires every field to be present', () => {
      expect(createCustomUserData(complete).isDataComplete).toBe(true);
      expect(createCustomUserData({ ...complete, zip: undefined }).isDataComplete).toBe(false);
    });

    // Feeds KycStep.complete() as the recorded step result, so it must carry exactly the required
    // fields and their current values.
    it('kycFieldData projects exactly the required fields', () => {
      const ud = createCustomUserData(complete);

      expect(Object.keys(ud.kycFieldData).sort()).toEqual([...ud.requiredKycFields].sort());
      expect(ud.kycFieldData).toMatchObject({ firstname: 'Jane', surname: 'Doe', zip: '6300' });
    });

    it('requiredInvoiceFields and isInvoiceDataComplete follow the account type', () => {
      const personal = createCustomUserData({ accountType: AccountType.PERSONAL, firstname: 'Jane', surname: 'Doe' });
      expect(personal.requiredInvoiceFields).toEqual(['accountType', 'firstname', 'surname']);
      expect(personal.isInvoiceDataComplete).toBe(true);

      const org = createCustomUserData({ accountType: AccountType.ORGANIZATION, organizationName: 'Acme AG' });
      expect(org.requiredInvoiceFields).toEqual(['accountType', 'organizationName']);
      expect(org.isInvoiceDataComplete).toBe(true);

      expect(
        createCustomUserData({ accountType: AccountType.ORGANIZATION, organizationName: undefined })
          .isInvoiceDataComplete,
      ).toBe(false);
    });
  });

  describe('module helpers', () => {
    it('KycCompleted only accepts COMPLETED', () => {
      expect(KycCompleted(KycStatus.COMPLETED)).toBe(true);
      expect(KycCompleted(KycStatus.NA)).toBe(false);
      expect(KycCompleted(undefined)).toBe(false);
    });

    // BlankType is a numeric enum, so the label is spelled out rather than interpolated from the value.
    it.each([
      ['phone', BlankType.PHONE, '+41791234567', '**********67'],
      ['mail', BlankType.MAIL, 'jane@test.ch', 'j***@test.ch'],
      ['wallet address', BlankType.WALLET_ADDRESS, '0x1234567890abcdef', '0x12********cdef'],
    ])('Blank masks a %s', (_label, type, value, expected) => {
      expect(Blank(value as string, type as BlankType)).toBe(expected);
    });

    it.each([undefined, null, ''])('Blank passes %p through untouched', (value) => {
      expect(Blank(value as string, BlankType.MAIL)).toBe(value);
    });
  });

  // The decorator callbacks only run when TypeORM builds its metadata, so a spec that never touches
  // them leaves 22 relation declarations untested. Reading them back and invoking them asserts that
  // every declared target resolves and every inverse side points at a real property.
  describe('schema declarations', () => {
    it('resolves the target and inverse side of every declared relation', () => {
      const relations = getMetadataArgsStorage().relations.filter((r) => r.target === UserData);
      // Probe answers any property access with its own name, so an inverse-side lambda
      // `(x) => x.userData` returns the string 'userData'.
      const probe = new Proxy({}, { get: (_target, property) => property });

      expect(relations.length).toBeGreaterThanOrEqual(22);

      for (const relation of relations) {
        expect((relation.type as () => unknown)()).toBeDefined();

        if (typeof relation.inverseSideProperty === 'function') {
          expect((relation.inverseSideProperty as (o: unknown) => unknown)(probe)).toBeTruthy();
        }
      }
    });

    // The partial unique index is what stops the same identity document from being registered twice
    // under the same nationality/account/kyc type. Its column list is a callback, so it is only
    // exercised here.
    it('declares the partial unique index over the identity document tuple', () => {
      const index = getMetadataArgsStorage().indices.find(
        (i) => i.target === UserData && typeof i.columns === 'function',
      );

      expect(index).toBeDefined();
      expect(index!.unique).toBe(true);
      expect(index!.where).toBe(
        '"identDocumentId" IS NOT NULL AND "accountType" IS NOT NULL AND "kycType" IS NOT NULL',
      );
      expect(
        (index!.columns as (u: unknown) => unknown[])({
          identDocumentId: 'DOC',
          nationality: 'NATIONALITY',
          accountType: 'ACCOUNT_TYPE',
          kycType: 'KYC_TYPE',
        }),
      ).toEqual(['DOC', 'NATIONALITY', 'ACCOUNT_TYPE', 'KYC_TYPE']);
    });

    it('declares kycSteps and users as the inverse of their userData relation', () => {
      const relations = getMetadataArgsStorage().relations.filter((r) => r.target === UserData);
      const probe = new Proxy({}, { get: (_target, property) => property });

      const kycSteps = relations.find((r) => r.propertyName === 'kycSteps');
      expect(kycSteps!.relationType).toBe('one-to-many');
      expect((kycSteps!.type as () => unknown)()).toBe(KycStep);
      expect((kycSteps!.inverseSideProperty as (o: unknown) => unknown)(probe)).toBe('userData');

      const users = relations.find((r) => r.propertyName === 'users');
      expect(users!.relationType).toBe('one-to-many');
      expect((users!.type as () => unknown)()).toBe(User);
      expect((users!.inverseSideProperty as (o: unknown) => unknown)(probe)).toBe('userData');
    });
  });
});
