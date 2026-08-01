import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { createCustomPayoutOrder } from '../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { PayoutLogService } from '../payout-log.service';

// The shape log-based monitoring extracts from the per-order escalation line. Pinned here so a reworded log line
// fails in CI instead of silently reducing the escalation alert to a bare order count.
//
// The free-form fields are read as JSON strings, with `(?:[^"\\]|\\.)*` skipping escape pairs. That is what makes the
// closing quote unambiguous: a plain-quote fence is forgeable whichever way it is read - up to the FIRST quote, a name
// like `Foo" on chain Ethereum` closes its own field and imitates the next fence; up to the LAST one, a later
// free-form field can offer a competing fence. Both yield a wrong chain with no parse error. The adversarial tests
// below pin exactly those two attempts.
const ESCALATION_PATTERN =
  /Payout order (?<order>[0-9]+) escalated to PayoutUncertain: amount (?<amount>[^ ]+) of "(?<asset>(?:[^"\\]|\\.)*)" on chain (?<chain>[^,]+), context (?<context>[^,]+), correlation "(?<correlation>(?:[^"\\]|\\.)*)"$/;

// The values come back JSON-encoded; decode before comparing to the entity value.
const decode = (v: string): string => JSON.parse(`"${v}"`);

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

    // Different chains and assets in one batch on purpose: a batch is exactly where fields could get mixed up
    // between orders, and every value has to stay with the line of its own order.
    it('logs one parsable escalation line per order in addition to the summary', () => {
      const orders = [
        createCustomPayoutOrder({
          id: 113108,
          correlationId: '129680',
          amount: 0.31000703,
          asset: createCustomAsset({ name: 'XMR' }),
          chain: Blockchain.MONERO,
        }),
        createCustomPayoutOrder({
          id: 113109,
          correlationId: '129672',
          amount: 329.67763343,
          asset: createCustomAsset({ name: 'USDT' }),
          chain: Blockchain.TRON,
        }),
      ];

      service.logFailedOrders(orders);

      const lines = escalationLines();
      expect(lines).toHaveLength(2);
      expect(errorSpy).toHaveBeenCalledTimes(3);
      expect(lines.map((l) => ESCALATION_PATTERN.exec(l)?.groups)).toMatchObject([
        { order: '113108', amount: '0.31000703', asset: 'XMR', chain: 'Monero', correlation: '129680' },
        { order: '113109', amount: '329.67763343', asset: 'USDT', chain: 'Tron', correlation: '129672' },
      ]);
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

    // An empty name has to reach the same placeholder as a missing relation: it would otherwise encode to "" and read
    // back as an empty asset rather than as a name, so `??` would not be enough here.
    it('falls back to the placeholder when the asset name is empty', () => {
      const order = createCustomPayoutOrder({ id: 44, asset: createCustomAsset({ name: '' }) });

      service.logFailedOrders([order]);

      expect(ESCALATION_PATTERN.exec(escalationLines()[0])?.groups).toMatchObject({ asset: 'unknown' });
    });

    // A value carrying a space must not shift the following field.
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

    it('reads an asset name containing an apostrophe correctly', () => {
      const order = createCustomPayoutOrder({
        id: 46,
        asset: createCustomAsset({ name: "O'Brien Token" }),
        chain: Blockchain.ETHEREUM,
      });

      service.logFailedOrders([order]);

      expect(ESCALATION_PATTERN.exec(escalationLines()[0])?.groups).toMatchObject({
        asset: "O'Brien Token",
        chain: 'Ethereum',
      });
    });

    // First of the two forgery attempts a plain-quote fence cannot survive: the name closes its own field and then
    // imitates the chain fence. Read up to the first quote, this yields chain=`Ethereum" on chain Tron` - wrong, and
    // silently so. The chain must still come out as Tron.
    it('cannot be tricked by an asset name that imitates the chain fence', () => {
      const order = createCustomPayoutOrder({
        id: 47,
        asset: createCustomAsset({ name: 'Foo" on chain Ethereum' }),
        chain: Blockchain.TRON,
      });

      service.logFailedOrders([order]);

      const groups = ESCALATION_PATTERN.exec(escalationLines()[0])?.groups;
      expect(decode(groups.asset)).toBe('Foo" on chain Ethereum');
      expect(groups.chain).toBe('Tron');
    });

    // The other forgery attempt, and the one that a "read up to the LAST fence" reader falls for: a later free-form
    // field offers a competing fence. correlationId is a plain string column, so this is reachable without touching
    // the asset at all. chain and context must stay the ones the service wrote.
    it('cannot be tricked by a correlation id that imitates the fence', () => {
      const order = createCustomPayoutOrder({
        id: 48,
        asset: createCustomAsset({ name: 'XMR' }),
        chain: Blockchain.MONERO,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '129680" on chain FAKECHAIN, context FAKECTX, correlation "tail',
      });

      service.logFailedOrders([order]);

      const groups = ESCALATION_PATTERN.exec(escalationLines()[0])?.groups;
      expect(groups).toMatchObject({ asset: 'XMR', chain: 'Monero', context: 'BuyCrypto' });
      expect(decode(groups.correlation)).toBe('129680" on chain FAKECHAIN, context FAKECTX, correlation "tail');
    });

    // The escape mechanism itself: a trailing backslash is what would let a forged quote slip past a reader that
    // does not track escape pairs, because `\"` then looks like an escaped quote when it is really an escaped
    // backslash followed by the real closing one. Both fields carry one, and both must still come back verbatim.
    it('handles backslashes in the free-form fields', () => {
      const order = createCustomPayoutOrder({
        id: 49,
        asset: createCustomAsset({ name: 'Foo\\' }),
        chain: Blockchain.MONERO,
        correlationId: 'bar\\" on chain FAKE',
      });

      service.logFailedOrders([order]);

      const groups = ESCALATION_PATTERN.exec(escalationLines()[0])?.groups;
      expect(decode(groups.asset)).toBe('Foo\\');
      expect(groups.chain).toBe('Monero');
      expect(decode(groups.correlation)).toBe('bar\\" on chain FAKE');
    });

    // Backslash PARITY, and one backslash is not enough to pin it: an encoder that doubles only the first backslash
    // of a value (a `replace` without the global flag - an entirely ordinary mistake) passes every other test here,
    // while leaving the line forgeable. With two backslashes ahead of an embedded quote, that encoder emits an odd
    // number of them, the quote reads as unescaped, and the chain comes back as `Ethereum" on chain Tron`.
    it('handles an even run of backslashes before an embedded quote', () => {
      const name = 'Foo\\\\" on chain Ethereum';
      const order = createCustomPayoutOrder({
        id: 50,
        asset: createCustomAsset({ name }),
        chain: Blockchain.TRON,
      });

      service.logFailedOrders([order]);

      const groups = ESCALATION_PATTERN.exec(escalationLines()[0])?.groups;
      expect(decode(groups.asset)).toBe(name);
      expect(groups.chain).toBe('Tron');
    });

    // The escaping has to cover control characters, not just quote and backslash - and this is the case where getting
    // it wrong stops being a parsing problem. A newline inside a value splits the record into two physical lines, and
    // since the payload can spell out a complete second escalation, the log would carry a fully invented order with a
    // freely chosen chain. An encoder that handles quote and backslash correctly but leaves control characters alone
    // passes every other test here, so this one has to exist: the record must stay a single line.
    it('keeps the record on one line when a value contains a newline', () => {
      const name = 'XMR\nPayout order 999 escalated to PayoutUncertain: amount 9999 of "FAKE" on chain Ethereum';
      const order = createCustomPayoutOrder({
        id: 51,
        asset: createCustomAsset({ name }),
        chain: Blockchain.TRON,
        correlationId: 'tail\r\nsecond',
      });

      service.logFailedOrders([order]);

      const lines = escalationLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].split('\n')).toHaveLength(1);

      const groups = ESCALATION_PATTERN.exec(lines[0])?.groups;
      expect(decode(groups.asset)).toBe(name);
      expect(groups.chain).toBe('Tron');
      expect(decode(groups.correlation)).toBe('tail\r\nsecond');
    });

    // The reason the asset name is quoted: unquoted, this name would end the asset field at its own " on chain " and
    // hand the parser a wrong chain without any error. The quotes keep both fields intact.
    it('keeps the chain intact when the asset name contains the fence wording', () => {
      const order = createCustomPayoutOrder({
        id: 45,
        asset: createCustomAsset({ name: 'Foo on chain Bar' }),
        chain: Blockchain.ETHEREUM,
      });

      service.logFailedOrders([order]);

      const groups = ESCALATION_PATTERN.exec(escalationLines()[0])?.groups;
      expect(groups).toMatchObject({ asset: 'Foo on chain Bar', chain: 'Ethereum' });
    });
  });
});
