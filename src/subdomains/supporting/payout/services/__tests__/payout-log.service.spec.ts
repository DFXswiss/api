import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { createCustomPayoutOrder } from '../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { PayoutLogService } from '../payout-log.service';

// The shape log-based monitoring extracts from the per-order escalation line. Pinned here so a reworded log line
// fails in CI instead of silently reducing the escalation alert to a bare order count.
const ESCALATION_PATTERN =
  /Payout order (?<order>[0-9]+) escalated to PayoutUncertain: amount (?<amount>[^ ]+) of (?<asset>.+?) on chain (?<chain>[^,]+), context (?<context>[^,]+), correlation (?<correlation>.+)$/;

describe('PayoutLogService', () => {
  describe('#logFailedOrders(...)', () => {
    let service: PayoutLogService;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      service = new PayoutLogService();
      errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const escalationLines = (): string[] =>
      errorSpy.mock.calls.map((c) => c[0] as string).filter((m) => m.includes('escalated to PayoutUncertain'));

    it('logs nothing for an empty batch', () => {
      const message = service.logFailedOrders([]);

      expect(errorSpy).not.toHaveBeenCalled();
      expect(message).toContain('0 payout order(s) failed and pending investigation');
    });

    it('keeps the summary line and its return value unchanged', () => {
      const order = createCustomPayoutOrder({ id: 113108, correlationId: '129680' });

      const message = service.logFailedOrders([order]);

      expect(message).toBe(
        '1 payout order(s) failed and pending investigation: [Order ID: 113108, Context: BuyCrypto, CorrelationID: 129680] ',
      );
      expect(errorSpy).toHaveBeenCalledWith(message);
    });

    it('logs one parsable escalation line per order in addition to the summary', () => {
      const orders = [
        createCustomPayoutOrder({ id: 113108, correlationId: '129680' }),
        createCustomPayoutOrder({ id: 113109, correlationId: '129672' }),
      ];

      service.logFailedOrders(orders);

      const lines = escalationLines();
      expect(lines).toHaveLength(2);
      expect(errorSpy).toHaveBeenCalledTimes(3);
      expect(lines.map((l) => ESCALATION_PATTERN.exec(l)?.groups.order)).toEqual(['113108', '113109']);
    });

    it('exposes amount, asset and chain of the payout', () => {
      const order = createCustomPayoutOrder({
        id: 113107,
        amount: 1.53111317,
        asset: createCustomAsset({ name: 'XMR', blockchain: Blockchain.MONERO }),
        chain: Blockchain.MONERO,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '129674',
      });

      service.logFailedOrders([order]);

      const groups = ESCALATION_PATTERN.exec(escalationLines()[0])?.groups;
      expect(groups).toMatchObject({
        order: '113107',
        amount: '1.53111317',
        asset: 'XMR',
        chain: 'Monero',
        context: 'BuyCrypto',
        correlation: '129674',
      });
    });

    // The asset relation is nullable on the entity, and a line that stops matching would drop the order out of the
    // alert entirely - it has to degrade to a placeholder, not to an unparsable line.
    it('stays parsable when the order carries no asset', () => {
      const order = createCustomPayoutOrder({ id: 42, asset: null, chain: Blockchain.BITCOIN, amount: 0.5 });

      service.logFailedOrders([order]);

      const groups = ESCALATION_PATTERN.exec(escalationLines()[0])?.groups;
      expect(groups).toMatchObject({ order: '42', amount: '0.5', asset: 'unknown', chain: 'Bitcoin' });
    });

    // A chain or asset value carrying a space must not shift the following field, which is why every value is fenced
    // by a literal on both sides.
    it('keeps the fields separated when a value contains a space', () => {
      const order = createCustomPayoutOrder({
        id: 43,
        asset: createCustomAsset({ name: 'Wrapped BTC' }),
        chain: Blockchain.ETHEREUM,
      });

      service.logFailedOrders([order]);

      const groups = ESCALATION_PATTERN.exec(escalationLines()[0])?.groups;
      expect(groups).toMatchObject({ asset: 'Wrapped BTC', chain: 'Ethereum' });
    });
  });
});
