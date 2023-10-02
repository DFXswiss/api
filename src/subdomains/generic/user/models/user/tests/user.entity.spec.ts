import { Test } from '@nestjs/testing';
import { Asset, FeeTier } from 'src/shared/models/asset/asset.entity';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomUserData } from '../../user-data/__mocks__/user-data.entity.mock';
import { AccountType } from '../../user-data/account-type.enum';
import { createDefaultWallet } from '../../wallet/__mocks__/wallet.entity.mock';
import { createCustomUser } from '../__mocks__/user.entity.mock';
import { FeeType, User } from '../user.entity';

describe('User', () => {
  function setup(
    accountType: AccountType,
    buyFee?: number,
    usedRef?: string,
    cryptoFee?: number,
    sellFee?: number,
  ): User {
    return createCustomUser({
      buyFee,
      usedRef,
      cryptoFee,
      sellFee,
      userData: createCustomUserData({ accountType: accountType }),
      wallet: createDefaultWallet(),
    });
  }

  beforeEach(async () => {
    await Test.createTestingModule({
      providers: [TestUtil.provideConfig()],
    }).compile();
  });

  // tier 0 buy
  it('should return personal tier0 buy fee', async () => {
    const user = setup(AccountType.PERSONAL);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER0 } as Asset)).toStrictEqual(0);
  });

  // tier 0 sell
  it('should return personal tier0 sell fee', async () => {
    const user = setup(AccountType.PERSONAL);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER0 } as Asset)).toStrictEqual(0);
  });

  // tier 1 buy
  it('should return personal tier1 buy fee', async () => {
    const user = setup(AccountType.PERSONAL);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER1 } as Asset)).toStrictEqual(0.0099);
  });

  it('should return business tier1 buy fee', async () => {
    const user = setup(AccountType.BUSINESS);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER1 } as Asset)).toStrictEqual(0.0149);
  });

  it('should return business tier1 buy fee', async () => {
    const user = setup(AccountType.SOLE_PROPRIETORSHIP);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER1 } as Asset)).toStrictEqual(0.0149);
  });

  // tier 1 sell
  it('should return personal tier1 sell fee', async () => {
    const user = setup(AccountType.PERSONAL);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER1 } as Asset)).toStrictEqual(0.0149);
  });

  it('should return business tier1 sell fee', async () => {
    const user = setup(AccountType.BUSINESS);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER1 } as Asset)).toStrictEqual(0.0199);
  });

  it('should return business tier1 sell fee', async () => {
    const user = setup(AccountType.SOLE_PROPRIETORSHIP);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER1 } as Asset)).toStrictEqual(0.0199);
  });

  // tier 2 buy
  it('should return personal tier2 buy fee', async () => {
    const user = setup(AccountType.PERSONAL);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER2 } as Asset)).toStrictEqual(0.0149);
  });

  it('should return business tier2 buy fee', async () => {
    const user = setup(AccountType.BUSINESS);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER2 } as Asset)).toStrictEqual(0.0199);
  });

  it('should return business tier2 buy fee', async () => {
    const user = setup(AccountType.SOLE_PROPRIETORSHIP);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER2 } as Asset)).toStrictEqual(0.0199);
  });

  // tier 2 sell
  it('should return personal tier2 sell fee', async () => {
    const user = setup(AccountType.PERSONAL);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER2 } as Asset)).toStrictEqual(0.0199);
  });

  it('should return business tier2 sell fee', async () => {
    const user = setup(AccountType.BUSINESS);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER2 } as Asset)).toStrictEqual(0.0249);
  });

  it('should return business tier2 sell fee', async () => {
    const user = setup(AccountType.SOLE_PROPRIETORSHIP);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER2 } as Asset)).toStrictEqual(0.0249);
  });

  // tier 3 buy
  it('should return personal tier3 buy fee', async () => {
    const user = setup(AccountType.PERSONAL);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER3 } as Asset)).toStrictEqual(0.0225);
  });

  it('should return business tier3 buy fee', async () => {
    const user = setup(AccountType.BUSINESS);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER3 } as Asset)).toStrictEqual(0.0275);
  });

  it('should return business tier3 buy fee', async () => {
    const user = setup(AccountType.SOLE_PROPRIETORSHIP);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER3 } as Asset)).toStrictEqual(0.0275);
  });

  // tier 3 sell
  it('should return personal tier3 sell fee', async () => {
    const user = setup(AccountType.PERSONAL);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER3 } as Asset)).toStrictEqual(0.0275);
  });

  it('should return business tier3 sell fee', async () => {
    const user = setup(AccountType.BUSINESS);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER3 } as Asset)).toStrictEqual(0.0325);
  });

  it('should return business tier3 sell fee', async () => {
    const user = setup(AccountType.SOLE_PROPRIETORSHIP);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER3 } as Asset)).toStrictEqual(0.0325);
  });

  // tier 4 buy
  it('should return personal tier4 buy fee', async () => {
    const user = setup(AccountType.PERSONAL);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER4 } as Asset)).toStrictEqual(0.0299);
  });

  it('should return business tier4 buy fee', async () => {
    const user = setup(AccountType.BUSINESS);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER4 } as Asset)).toStrictEqual(0.0349);
  });

  it('should return business tier4 buy fee', async () => {
    const user = setup(AccountType.SOLE_PROPRIETORSHIP);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER4 } as Asset)).toStrictEqual(0.0349);
  });

  // tier 4 sell
  it('should return personal tier4 sell fee', async () => {
    const user = setup(AccountType.PERSONAL);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER4 } as Asset)).toStrictEqual(0.0349);
  });

  it('should return business tier4 sell fee', async () => {
    const user = setup(AccountType.BUSINESS);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER4 } as Asset)).toStrictEqual(0.0399);
  });

  it('should return business tier4 sell fee', async () => {
    const user = setup(AccountType.SOLE_PROPRIETORSHIP);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER4 } as Asset)).toStrictEqual(0.0399);
  });

  // individual fee
  it('should return 0.005 when individual fee 0.005', async () => {
    const user = setup(AccountType.PERSONAL, 0.005);
    expect(user.getFee(FeeType.BUY, { feeTier: FeeTier.TIER1 } as Asset)).toStrictEqual(0.005);
  });

  it('should return 0.005 when individual fee 0.005', async () => {
    const user = setup(AccountType.PERSONAL, undefined, undefined, undefined, 0.005);
    expect(user.getFee(FeeType.SELL, { feeTier: FeeTier.TIER1 } as Asset)).toStrictEqual(0.005);
  });

  // crypto fee
  it('should return a fee of 0.0099 for crypto routes, if cryptoFee is not defined', async () => {
    const user = setup(AccountType.PERSONAL, undefined, undefined, undefined);
    expect(user.getFee(FeeType.CRYPTO)).toStrictEqual(0.0099);
  });

  it('should return custom fee for crypto routes, if cryptoFee is defined', async () => {
    const user = setup(AccountType.PERSONAL, undefined, undefined, 0.005);
    expect(user.getFee(FeeType.CRYPTO)).toStrictEqual(0.005);
  });
});
