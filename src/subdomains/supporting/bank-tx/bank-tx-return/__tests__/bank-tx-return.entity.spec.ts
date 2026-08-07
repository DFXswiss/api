import { ChargebackBlockReason } from 'src/subdomains/generic/support/dto/user-data-support.dto';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { KycStatus, RiskStatus, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { createCustomTransaction } from 'src/subdomains/supporting/payment/__mocks__/transaction.entity.mock';
import { FiatOutput } from '../../../fiat-output/fiat-output.entity';
import { BankTx } from '../../bank-tx/entities/bank-tx.entity';
import { BankTxReturn } from '../bank-tx-return.entity';

describe('BankTxReturn #getChargebackBlockReasons()', () => {
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

  // Inline fixture pattern (same as refund-creditor-data.spec.ts) — no dedicated mock factory.
  function pendingBankTxReturn(overrides: Partial<BankTxReturn> = {}): BankTxReturn {
    return Object.assign(new BankTxReturn(), {
      id: 1,
      chargebackAllowedDate: undefined,
      chargebackDate: undefined,
      chargebackOutput: undefined,
      chargebackBankTx: undefined,
      chargebackAmount: 50,
      chargebackIban: 'CH9300762011623852957',
      chargebackAsset: 'CHF',
      chargebackCreditorData: JSON.stringify({ name: 'Max Mustermann' }),
      inputAmount: 52,
      inputAsset: 'CHF',
      bankTx: Object.assign(new BankTx(), { id: 1 }),
      userData: releasedUserData(),
      transaction: createCustomTransaction({ id: 10, uid: 'T_BTR_1' }),
      ...overrides,
    });
  }

  it('returns empty array when all auto-promotion conditions are met', () => {
    expect(pendingBankTxReturn().getChargebackBlockReasons()).toEqual([]);
  });

  it('returns MISSING_CHARGEBACK_AMOUNT when chargebackAmount is missing', () => {
    const entity = pendingBankTxReturn({ chargebackAmount: undefined });
    expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.MISSING_CHARGEBACK_AMOUNT]);
  });

  it('returns MISSING_CHARGEBACK_TARGET when chargebackIban is missing', () => {
    const entity = pendingBankTxReturn({ chargebackIban: undefined });
    expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.MISSING_CHARGEBACK_TARGET]);
  });

  it('returns MISSING_CREDITOR_DATA when chargebackCreditorData is missing', () => {
    const entity = pendingBankTxReturn({ chargebackCreditorData: undefined });
    expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.MISSING_CREDITOR_DATA]);
  });

  it('returns NAME_MISMATCH when creditor name does not match customer names', () => {
    const entity = pendingBankTxReturn({
      chargebackCreditorData: JSON.stringify({ name: 'Someone Else' }),
    });
    expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.NAME_MISMATCH]);
  });

  it('does not return NAME_MISMATCH when creditor data is already missing', () => {
    const entity = pendingBankTxReturn({ chargebackCreditorData: undefined });
    const reasons = entity.getChargebackBlockReasons();
    expect(reasons).toContain(ChargebackBlockReason.MISSING_CREDITOR_DATA);
    expect(reasons).not.toContain(ChargebackBlockReason.NAME_MISMATCH);
  });

  it('returns USER_NOT_RELEASED when userData is blocked', () => {
    const entity = pendingBankTxReturn({
      userData: releasedUserData({ status: UserDataStatus.BLOCKED }),
    });
    expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.USER_NOT_RELEASED]);
  });

  it('returns USER_NOT_RELEASED when kycStatus CHECK (not allowed for BankTxReturn)', () => {
    const entity = pendingBankTxReturn({
      userData: releasedUserData({ kycStatus: KycStatus.CHECK }),
    });
    expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.USER_NOT_RELEASED]);
  });

  it('returns USER_NOT_RELEASED when riskStatus is not released', () => {
    const entity = pendingBankTxReturn({
      userData: releasedUserData({ riskStatus: RiskStatus.SUSPICIOUS }),
    });
    expect(entity.getChargebackBlockReasons()).toEqual([ChargebackBlockReason.USER_NOT_RELEASED]);
  });

  it('returns multiple reasons when several conditions fail', () => {
    const entity = pendingBankTxReturn({
      chargebackAmount: undefined,
      chargebackIban: undefined,
      chargebackCreditorData: undefined,
      userData: releasedUserData({ status: UserDataStatus.BLOCKED }),
    });
    expect(entity.getChargebackBlockReasons()).toEqual([
      ChargebackBlockReason.MISSING_CHARGEBACK_AMOUNT,
      ChargebackBlockReason.MISSING_CHARGEBACK_TARGET,
      ChargebackBlockReason.MISSING_CREDITOR_DATA,
      ChargebackBlockReason.USER_NOT_RELEASED,
    ]);
  });

  it('fail-closed: returns empty array when chargebackAllowedDate is set even if other reasons apply', () => {
    const entity = pendingBankTxReturn({
      chargebackAllowedDate: new Date(),
      chargebackAmount: undefined,
      chargebackIban: undefined,
      userData: releasedUserData({ status: UserDataStatus.BLOCKED }),
    });
    expect(entity.getChargebackBlockReasons()).toEqual([]);
  });

  it('fail-closed: returns empty array when chargebackDate is set', () => {
    const entity = pendingBankTxReturn({ chargebackDate: new Date(), chargebackAmount: undefined });
    expect(entity.getChargebackBlockReasons()).toEqual([]);
  });

  it('fail-closed: returns empty array when chargebackOutput is set', () => {
    const entity = pendingBankTxReturn({
      chargebackOutput: Object.assign(new FiatOutput(), { id: 1 }),
      chargebackAmount: undefined,
    });
    expect(entity.getChargebackBlockReasons()).toEqual([]);
  });

  it('fail-closed: returns empty array when chargebackBankTx is set', () => {
    const entity = pendingBankTxReturn({
      chargebackBankTx: Object.assign(new BankTx(), { id: 99 }),
      chargebackAmount: undefined,
    });
    expect(entity.getChargebackBlockReasons()).toEqual([]);
  });
});
