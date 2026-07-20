import { RefReward, RewardStatus } from '../ref-reward.entity';

function createRefReward(overrides: Partial<RefReward> = {}): RefReward {
  return Object.assign(new RefReward(), {
    id: 1,
    outputAmount: 0.2,
    status: RewardStatus.PAYING_OUT,
    ...overrides,
  });
}

describe('RefReward #complete(...) exact base-unit propagation (#4287 stage 4)', () => {
  it('stores the exact delivered base units (beyond 8 dp) handed from the linked REF_PAYOUT payout order', () => {
    const entity = createRefReward();

    // 0.2 ETH delivered as 18-dp wei — NOT representable in the 8-dp float `outputAmount`
    entity.complete('TX_ID_01', 200000000000000000n);

    expect(entity.outputAmountBaseUnits).toBe(200000000000000000n);
    // existing behaviour is untouched (backward compatible)
    expect(entity.txId).toBe('TX_ID_01');
    expect(entity.status).toBe(RewardStatus.COMPLETE);
    expect(entity.isComplete).toBe(true);
    expect(entity.outputAmount).toBe(0.2);
  });

  it('fails open to a null outputAmountBaseUnits when no base units are provided', () => {
    const entity = createRefReward();

    entity.complete('TX_ID_02');

    expect(entity.outputAmountBaseUnits).toBeNull();
    expect(entity.txId).toBe('TX_ID_02');
    expect(entity.status).toBe(RewardStatus.COMPLETE);
    expect(entity.isComplete).toBe(true);
  });
});
