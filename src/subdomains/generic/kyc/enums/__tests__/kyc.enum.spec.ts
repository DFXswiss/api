import { ConfigService } from 'src/config/config';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { REALUNIT_WALLET_NAME } from 'src/subdomains/supporting/notification/realunit-mail-rules';
import { KycStepName } from '../kyc-step-name.enum';
import { requiredKycSteps } from '../kyc.enum';

describe('requiredKycSteps', () => {
  beforeAll(() => {
    new ConfigService();
  });

  const buildWallet = (name?: string): Wallet => Object.assign(new Wallet(), { name });

  const buildUserData = (overrides: Partial<UserData> = {}): UserData => {
    const userData = new UserData();
    userData.accountType = AccountType.PERSONAL;
    userData.kycLevel = KycLevel.LEVEL_0;
    userData.kycSteps = [];
    userData.sellVolume = 0;
    userData.sellInitiatedDate = undefined;
    return Object.assign(userData, overrides);
  };

  it('requires FINANCIAL_DATA for a non-RealUnit wallet', () => {
    const userData = buildUserData({ wallet: buildWallet('DFX') });

    expect(requiredKycSteps(userData)).toContain(KycStepName.FINANCIAL_DATA);
  });

  it('requires FINANCIAL_DATA when no wallet is loaded (status quo)', () => {
    const userData = buildUserData({ wallet: undefined });

    expect(requiredKycSteps(userData)).toContain(KycStepName.FINANCIAL_DATA);
  });

  it('does not require FINANCIAL_DATA for a RealUnit wallet with no sell intent (buy relief)', () => {
    const userData = buildUserData({
      wallet: buildWallet(REALUNIT_WALLET_NAME),
      sellVolume: 0,
      sellInitiatedDate: undefined,
    });

    expect(requiredKycSteps(userData)).not.toContain(KycStepName.FINANCIAL_DATA);
  });

  it('requires FINANCIAL_DATA for a RealUnit wallet on sell intent before any volume (deadlock fix)', () => {
    const userData = buildUserData({
      wallet: buildWallet(REALUNIT_WALLET_NAME),
      sellVolume: 0,
      sellInitiatedDate: new Date(),
    });

    expect(requiredKycSteps(userData)).toContain(KycStepName.FINANCIAL_DATA);
  });

  it('requires FINANCIAL_DATA for a RealUnit wallet once the user has sold (pre-migration safety net)', () => {
    const userData = buildUserData({
      wallet: buildWallet(REALUNIT_WALLET_NAME),
      sellVolume: 100,
      sellInitiatedDate: undefined,
    });

    expect(requiredKycSteps(userData)).toContain(KycStepName.FINANCIAL_DATA);
  });
});
