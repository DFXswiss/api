import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RefBonusAgreementDto } from '../dto/ref-bonus-agreement.dto';

describe('RefBonusAgreementDto', () => {
  const validPlain = {
    usedRef: 'AAA-000',
    userId: 1,
    outputAssetId: 2,
    feeShare: 0.5,
    minTransactionId: 100,
  };

  it('should accept a fully valid plain object and retain assigned field values', async () => {
    const instance = plainToInstance(RefBonusAgreementDto, validPlain);
    const errors = await validate(instance);

    expect(errors).toHaveLength(0);

    const direct = new RefBonusAgreementDto();
    direct.usedRef = 'AAA-000';
    direct.userId = 1;
    direct.outputAssetId = 2;
    direct.feeShare = 0.5;
    direct.minTransactionId = 100;

    expect(direct.usedRef).toBe('AAA-000');
    expect(direct.userId).toBe(1);
    expect(direct.outputAssetId).toBe(2);
    expect(direct.feeShare).toBe(0.5);
    expect(direct.minTransactionId).toBe(100);
  });

  it('should reject when usedRef is missing or has wrong type', async () => {
    const without = plainToInstance(RefBonusAgreementDto, { ...validPlain, usedRef: undefined });
    const wrongType = plainToInstance(RefBonusAgreementDto, { ...validPlain, usedRef: 123 as any });

    const errorsWithout = await validate(without);
    const errorsWrongType = await validate(wrongType);

    expect(errorsWithout.find((e) => e.property === 'usedRef')).toBeDefined();
    expect(errorsWrongType.find((e) => e.property === 'usedRef')).toBeDefined();
  });

  it('should reject when userId is missing or has wrong type', async () => {
    const without = plainToInstance(RefBonusAgreementDto, { ...validPlain, userId: undefined });
    const wrongType = plainToInstance(RefBonusAgreementDto, { ...validPlain, userId: 'not-a-number' as any });

    const errorsWithout = await validate(without);
    const errorsWrongType = await validate(wrongType);

    expect(errorsWithout.find((e) => e.property === 'userId')).toBeDefined();
    expect(errorsWrongType.find((e) => e.property === 'userId')).toBeDefined();
  });

  it('should reject when outputAssetId is missing or has wrong type', async () => {
    const without = plainToInstance(RefBonusAgreementDto, { ...validPlain, outputAssetId: undefined });
    const wrongType = plainToInstance(RefBonusAgreementDto, {
      ...validPlain,
      outputAssetId: 'not-a-number' as any,
    });

    const errorsWithout = await validate(without);
    const errorsWrongType = await validate(wrongType);

    expect(errorsWithout.find((e) => e.property === 'outputAssetId')).toBeDefined();
    expect(errorsWrongType.find((e) => e.property === 'outputAssetId')).toBeDefined();
  });

  it('should reject when feeShare is missing or has wrong type', async () => {
    const without = plainToInstance(RefBonusAgreementDto, { ...validPlain, feeShare: undefined });
    const wrongType = plainToInstance(RefBonusAgreementDto, { ...validPlain, feeShare: 'not-a-number' as any });

    const errorsWithout = await validate(without);
    const errorsWrongType = await validate(wrongType);

    expect(errorsWithout.find((e) => e.property === 'feeShare')).toBeDefined();
    expect(errorsWrongType.find((e) => e.property === 'feeShare')).toBeDefined();
  });

  // The payout is a share of a fee that was actually collected, so anything outside (0, 1] would
  // pay out more than the fee itself or nothing at all.
  it.each([2, 1.0001, 0, -0.5])('should reject a feeShare of %p as outside (0, 1]', async (feeShare) => {
    const instance = plainToInstance(RefBonusAgreementDto, { ...validPlain, feeShare });

    const errors = await validate(instance);

    expect(errors.find((e) => e.property === 'feeShare')).toBeDefined();
  });

  it('should accept a feeShare of exactly 1', async () => {
    const instance = plainToInstance(RefBonusAgreementDto, { ...validPlain, feeShare: 1 });

    const errors = await validate(instance);

    expect(errors.find((e) => e.property === 'feeShare')).toBeUndefined();
  });

  it.each([-1, 1.5])('should reject a minTransactionId of %p', async (minTransactionId) => {
    const instance = plainToInstance(RefBonusAgreementDto, { ...validPlain, minTransactionId });

    const errors = await validate(instance);

    expect(errors.find((e) => e.property === 'minTransactionId')).toBeDefined();
  });

  it.each(['userId', 'outputAssetId'])('should reject a non-positive %s', async (field) => {
    const instance = plainToInstance(RefBonusAgreementDto, { ...validPlain, [field]: 0 });

    const errors = await validate(instance);

    expect(errors.find((e) => e.property === field)).toBeDefined();
  });

  it('should reject when minTransactionId is missing or has wrong type', async () => {
    const without = plainToInstance(RefBonusAgreementDto, { ...validPlain, minTransactionId: undefined });
    const wrongType = plainToInstance(RefBonusAgreementDto, {
      ...validPlain,
      minTransactionId: 'not-a-number' as any,
    });

    const errorsWithout = await validate(without);
    const errorsWrongType = await validate(wrongType);

    expect(errorsWithout.find((e) => e.property === 'minTransactionId')).toBeDefined();
    expect(errorsWrongType.find((e) => e.property === 'minTransactionId')).toBeDefined();
  });
});
