import { mock } from 'jest-mock-extended';
import { DexService } from 'src/payment/models/dex/services/dex.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { MailService } from 'src/shared/services/mail.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import {
  createCustomPayoutOrder,
  createDefaultPayoutOrder,
} from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { PayoutDeFiChainTokenStrategy } from '../payout-defichain-token.strategy';

describe('PayoutDeFiChainTokenStrategy', () => {
  let strategy: PayoutDeFiChainTokenStrategyWrapper;

  let mailService: MailService;
  let dexService: DexService;
  let defichainService: PayoutDeFiChainService;
  let payoutOrderRepo: PayoutOrderRepository;

  beforeEach(() => {
    mailService = mock<MailService>();
    dexService = mock<DexService>();
    defichainService = mock<PayoutDeFiChainService>();
    payoutOrderRepo = mock<PayoutOrderRepository>();

    strategy = new PayoutDeFiChainTokenStrategyWrapper(mailService, dexService, defichainService, payoutOrderRepo);
  });

  describe('#groupOrdersByTokens(...)', () => {
    it('returns an instance of Map', () => {
      expect(strategy.groupOrdersByTokenWrapper([])).toBeInstanceOf(Map);
      expect(strategy.groupOrdersByTokenWrapper([createDefaultPayoutOrder()])).toBeInstanceOf(Map);
    });

    it('separates orders in different groups by token', () => {
      const orders = [
        createCustomPayoutOrder({ asset: createCustomAsset({ dexName: 'BTC' }) }),
        createCustomPayoutOrder({ asset: createCustomAsset({ dexName: 'BTC' }) }),
        createCustomPayoutOrder({ asset: createCustomAsset({ dexName: 'ETH' }) }),
      ];

      const groups = strategy.groupOrdersByTokenWrapper(orders);

      expect([...groups.entries()].length).toBe(2);
      expect([...groups.keys()][0]).toBe('BTC');
      expect([...groups.keys()][1]).toBe('ETH');
      expect([...groups.values()][0].length).toBe(2);
      expect([...groups.values()][1].length).toBe(1);
    });

    it('puts orders with same token in one group', () => {
      const orders = [
        createCustomPayoutOrder({ asset: createCustomAsset({ dexName: 'BTC' }) }),
        createCustomPayoutOrder({ asset: createCustomAsset({ dexName: 'BTC' }) }),
        createCustomPayoutOrder({ asset: createCustomAsset({ dexName: 'BTC' }) }),
      ];

      const groups = strategy.groupOrdersByTokenWrapper(orders);

      expect([...groups.entries()].length).toBe(1);
      expect([...groups.keys()][0]).toBe('BTC');
      expect([...groups.values()][0].length).toBe(3);
    });
  });
});

class PayoutDeFiChainTokenStrategyWrapper extends PayoutDeFiChainTokenStrategy {
  constructor(
    mailService: MailService,
    dexService: DexService,
    defichainService: PayoutDeFiChainService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(mailService, dexService, defichainService, payoutOrderRepo);
  }

  groupOrdersByTokenWrapper(orders: PayoutOrder[]) {
    return this.groupOrdersByTokens(orders);
  }
}
