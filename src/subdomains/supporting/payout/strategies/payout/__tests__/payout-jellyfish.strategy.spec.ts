import { mock } from 'jest-mock-extended';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import {
  createCustomPayoutOrder,
  createDefaultPayoutOrder,
} from '../../../entities/__mocks__/payout-order.entity.mock';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { JellyfishStrategy } from '../impl/base/jellyfish.strategy';

describe('PayoutJellyfishStrategy', () => {
  let strategy: PayoutJellyfishStrategyWrapper;

  let notificationService: NotificationService;
  let payoutOrderRepo: PayoutOrderRepository;
  let defichainService: PayoutDeFiChainService;

  let repoSaveSpy: jest.SpyInstance;
  let sendErrorMailSpy: jest.SpyInstance;

  beforeEach(() => {
    notificationService = mock<NotificationService>();
    payoutOrderRepo = mock<PayoutOrderRepository>();
    defichainService = mock<PayoutDeFiChainService>();

    repoSaveSpy = jest.spyOn(payoutOrderRepo, 'save');
    sendErrorMailSpy = jest.spyOn(notificationService, 'sendMail');

    strategy = new PayoutJellyfishStrategyWrapper(notificationService, payoutOrderRepo, defichainService);
  });

  afterEach(() => {
    repoSaveSpy.mockClear();
    sendErrorMailSpy.mockClear();
  });

  describe('#groupOrdersByContext(...)', () => {
    it('returns an instance of Map', () => {
      expect(strategy.groupOrdersByContextWrapper([])).toBeInstanceOf(Map);
      expect(strategy.groupOrdersByContextWrapper([createDefaultPayoutOrder()])).toBeInstanceOf(Map);
    });

    it('separates orders in different groups by context', () => {
      const orders = [
        createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO }),
        createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO }),
        createCustomPayoutOrder({ context: PayoutOrderContext.STAKING_REWARD }),
      ];

      const groups = strategy.groupOrdersByContextWrapper(orders);

      expect([...groups.entries()].length).toBe(2);
      expect([...groups.keys()][0]).toBe(PayoutOrderContext.BUY_CRYPTO);
      expect([...groups.keys()][1]).toBe(PayoutOrderContext.STAKING_REWARD);
      expect([...groups.values()][0].length).toBe(2);
      expect([...groups.values()][1].length).toBe(1);
    });

    it('puts orders with same context in one group', () => {
      const orders = [
        createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO }),
        createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO }),
        createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO }),
      ];

      const groups = strategy.groupOrdersByContextWrapper(orders);

      expect([...groups.entries()].length).toBe(1);
      expect([...groups.keys()][0]).toBe(PayoutOrderContext.BUY_CRYPTO);
      expect([...groups.values()][0].length).toBe(3);
    });
  });

  describe('#createPayoutGroups(...)', () => {
    it('restricts grouping orders with different assets', () => {
      const orders = [
        createCustomPayoutOrder({ asset: createCustomAsset({ dexName: 'BTC' }) }),
        createCustomPayoutOrder({ asset: createCustomAsset({ dexName: 'ETH' }) }),
      ];

      const testCall = () => strategy.createPayoutGroupsWrapper(orders, 10);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Cannot group orders of different assets to same payout group');
    });

    it('restricts zero maxGroupSize', () => {
      const orders = [createDefaultPayoutOrder()];

      const testCall = () => strategy.createPayoutGroupsWrapper(orders, 0);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Max group size for payout cannot be 0');
    });

    it('returns array of arrays', () => {
      const orders = [createDefaultPayoutOrder()];

      const groups = strategy.createPayoutGroupsWrapper(orders, 10);

      expect(Array.isArray(groups)).toBe(true);
      expect(Array.isArray(groups[0])).toBe(true);
    });

    it('distributes payouts to same address to different payout groups', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
      ];

      const groups = strategy.createPayoutGroupsWrapper(orders, 10);

      expect(groups.length).toBe(2);
    });

    it('limits maximum amount of orders per group', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_03' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_04' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_05' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_06' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_07' }),
      ];

      const groups = strategy.createPayoutGroupsWrapper(orders, 4);

      expect(groups.length).toBe(2);
      expect(groups[0].length).toBe(4);
      expect(groups[1].length).toBe(3);
    });
  });

  describe('#aggregatePayout(...)', () => {
    it('reduces all orders to same address in one group for this address', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
      ];

      const groups = strategy.aggregatePayoutWrapper(orders);

      expect(groups.length).toBe(2);
      expect(groups[0].addressTo).toBe('ADDR_01');
      expect(groups[1].addressTo).toBe('ADDR_02');
    });

    it('sums up all amounts to same address', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 1 }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 2 }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 3 }),
      ];

      const groups = strategy.aggregatePayoutWrapper(orders);

      expect(groups.length).toBe(1);
      expect(groups[0].addressTo).toBe('ADDR_01');
      expect(groups[0].amount).toBe(6);
    });

    it('rounds all final amounts to 8 digits', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 1.000000003 }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 2.000000003 }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 3.000000003 }),
      ];

      const groups = strategy.aggregatePayoutWrapper(orders);

      expect(groups.length).toBe(1);
      expect(groups[0].addressTo).toBe('ADDR_01');
      expect(groups[0].amount).toBe(6.00000001);
    });
  });

  describe('#designatePayout(...)', () => {
    it('sets every order a PAYOUT_DESIGNATED status', () => {
      const orders = [
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
      ];

      strategy.designatePayoutWrapper(orders);

      expect(orders.every((order) => order.status === PayoutOrderStatus.PAYOUT_DESIGNATED));
    });

    it('saves updated order to repo', async () => {
      const orders = [
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
      ];

      await strategy.designatePayoutWrapper(orders);

      expect(repoSaveSpy).toBeCalledTimes(3);
    });
  });

  describe('#rollbackPayoutDesignation(...)', () => {
    it('rolls back every order to a PREPARATION_CONFIRMED status', () => {
      const orders = [
        createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_DESIGNATED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_DESIGNATED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_DESIGNATED }),
      ];

      strategy.rollbackPayoutDesignationWrapper(orders);

      expect(orders.every((order) => order.status === PayoutOrderStatus.PREPARATION_CONFIRMED));
    });

    it('saves updated order to repo', async () => {
      const orders = [
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
      ];

      await strategy.rollbackPayoutDesignationWrapper(orders);

      expect(repoSaveSpy).toBeCalledTimes(3);
    });
  });

  describe('#sendNonRecoverableErrorMailWrapper(...)', () => {
    it('combines custom message with error message', async () => {
      await strategy.sendNonRecoverableErrorMailWrapper(
        createDefaultPayoutOrder(),
        'Test message',
        new Error('Another message'),
      );

      expect(sendErrorMailSpy).toBeCalledTimes(1);
      expect(sendErrorMailSpy).toBeCalledWith({
        input: { errors: ['Test message', 'Another message'], subject: 'Payout Error' },
        type: 'ErrorMonitoring',
        metadata: {
          context: 'Payout',
          correlationId: 'PayoutOrder&BuyCrypto&1',
        },
        options: {
          suppressRecurring: true,
        },
      });
    });

    it('calls notificationService with Payout Error subject', async () => {
      await strategy.sendNonRecoverableErrorMailWrapper(createDefaultPayoutOrder(), '');

      expect(sendErrorMailSpy).toBeCalledTimes(1);
      expect(sendErrorMailSpy).toBeCalledWith({
        input: { errors: [''], subject: 'Payout Error' },
        type: 'ErrorMonitoring',
        metadata: {
          context: 'Payout',
          correlationId: 'PayoutOrder&BuyCrypto&1',
        },
        options: {
          suppressRecurring: true,
        },
      });
    });
  });
});

class PayoutJellyfishStrategyWrapper extends JellyfishStrategy {
  constructor(
    notificationService: NotificationService,
    payoutOrderRepo: PayoutOrderRepository,
    defichainService: PayoutDeFiChainService,
  ) {
    super(notificationService, payoutOrderRepo, defichainService);
  }

  protected doPayoutForContext(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  protected async dispatchPayout(): Promise<string> {
    return 'TX_ID_01';
  }

  groupOrdersByContextWrapper(orders: PayoutOrder[]) {
    return this.groupOrdersByContext(orders);
  }

  createPayoutGroupsWrapper(orders: PayoutOrder[], maxGroupSize: number) {
    return this.createPayoutGroups(orders, maxGroupSize);
  }

  aggregatePayoutWrapper(orders: PayoutOrder[]) {
    return this.aggregatePayout(orders);
  }

  designatePayoutWrapper(orders: PayoutOrder[]) {
    return this.designatePayout(orders);
  }

  rollbackPayoutDesignationWrapper(orders: PayoutOrder[]) {
    return this.rollbackPayoutDesignation(orders);
  }

  sendNonRecoverableErrorMailWrapper(order: PayoutOrder, message: string, e?: Error) {
    return this.sendNonRecoverableErrorMail(order, message, e);
  }

  estimateFee(): Promise<FeeResult> {
    throw new Error('Method not implemented.');
  }

  protected getFeeAsset(): Promise<Asset> {
    throw new Error('Method not implemented.');
  }
}
