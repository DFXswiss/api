import { PayoutOrderRepository } from '../payout-order.repository';

describe('PayoutOrderRepository', () => {
  it('constructs against the provided entity manager', () => {
    const repo = new PayoutOrderRepository({} as any);

    expect(repo).toBeInstanceOf(PayoutOrderRepository);
  });
});
