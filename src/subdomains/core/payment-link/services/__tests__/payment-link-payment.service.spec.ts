import { ConfigService, GetConfig } from 'src/config/config';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/utils/util';
import { EntityManager, In } from 'typeorm';
import { PaymentDevice, PaymentLinkPayment } from '../../entities/payment-link-payment.entity';
import { PaymentQuote } from '../../entities/payment-quote.entity';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus, PaymentQuoteStatus } from '../../enums';
import { PaymentLinkPaymentRepository } from '../../repositories/payment-link-payment.repository';
import { PaymentActivationService } from '../payment-activation.service';
import { PaymentLinkPaymentService } from '../payment-link-payment.service';
import { PaymentQuoteService } from '../payment-quote.service';
import { PaymentWebhookService } from '../payment-webhook.service';

/**
 * The delivery channels of this service are process-local, while the jobs writing the payments run
 * in one process only. Every test here therefore describes one process: what it holds, what it may
 * read, and what it delivers — never who wrote the row it reads.
 */
describe('PaymentLinkPaymentService', () => {
  let service: PaymentLinkPaymentService;
  let paymentLinkPaymentRepo: jest.Mocked<PaymentLinkPaymentRepository>;
  let paymentWebhookService: jest.Mocked<PaymentWebhookService>;
  let paymentQuoteService: jest.Mocked<PaymentQuoteService>;
  let paymentActivationService: jest.Mocked<PaymentActivationService>;

  /**
   * Times are relative to now because the delivery read is: it asks for payments whose own end has
   * not passed by more than the grace, so a payment dated at a fixed calendar point would sit
   * outside every read these tests set up.
   *
   * `expiryDate` is what the read selects on — deliberately a column no later write moves. The
   * default puts a payment inside the read; a test that wants one outside says so.
   */
  function payment(values: Partial<PaymentLinkPayment>): PaymentLinkPayment {
    return Object.assign(new PaymentLinkPayment(), {
      id: 7,
      status: PaymentLinkPaymentStatus.PENDING,
      mode: PaymentLinkPaymentMode.SINGLE,
      txCount: 0,
      updated: Util.secondsBefore(1),
      expiryDate: Util.minutesAfter(5),
      link: {},
      ...values,
    });
  }

  /** Resolves to the payment if it was delivered, and to a marker if nothing was. */
  async function delivery(waiting: Promise<PaymentLinkPayment>): Promise<PaymentLinkPayment | string> {
    return Promise.race([
      waiting,
      new Promise<string>((resolve) => setTimeout(() => resolve('nothing delivered'), 50)),
    ]);
  }

  /**
   * Stands in for the gateway's sockets. Records what was handed over AND answers whether it got
   * out — the delivery only marks a command as delivered on `true`, so a sink that always said
   * yes would hide exactly the failure the record has to survive.
   */
  function devices(delivers = true): PaymentDevice[] {
    const seen: PaymentDevice[] = [];
    service.useDeviceSink((device) => {
      seen.push(device);
      return delivers;
    });

    return seen;
  }

  /**
   * Stands in for the gateway's socket map. The service reads the connected devices out of it on
   * every delivery, so a device is connected here for exactly as long as this map says so — there
   * is no register in the service to register with.
   */
  let sockets: Set<string>;

  function connect(deviceId: string): void {
    sockets.add(deviceId);
  }

  /** The rows the database holds for the delivery read below. */
  let rows: PaymentLinkPayment[];

  /**
   * Answers the delivery read out of `rows`, honouring EVERY condition each clause carries — the
   * devices asked for, the cutoff, and the state that makes a payment worth delivering. Which rows
   * the read admits is the whole subject of the tests that use this, so a mock that returned a
   * fixed list whatever it was asked for would prove nothing about them.
   */
  function findByCutoff(options: unknown): PaymentLinkPayment[] {
    const clauses = (
      options as {
        where: {
          deviceId: { value: string[] };
          expiryDate: { value: Date };
          status?: { value: PaymentLinkPaymentStatus };
          txCount?: { value: number };
        }[];
      }
    ).where;

    return rows.filter((row) =>
      clauses.some(
        (clause) =>
          clause.deviceId.value.includes(row.deviceId) &&
          row.expiryDate > clause.expiryDate.value &&
          (clause.status == null || row.status !== clause.status.value) &&
          (clause.txCount == null || row.txCount > clause.txCount.value),
      ),
    );
  }

  /**
   * The row the transition competes for, and the only thing that says whether a caller won: the
   * manager below applies an update exactly when its criteria still match, as the database does.
   */
  let row: PaymentLinkPayment;

  /**
   * Stands in for the transaction the transition runs in, statements included. Statements are
   * staged and written back to `row` only when the callback returns — a callback that throws
   * leaves the row as it was, which is what a rollback means and what these tests are about.
   */
  function transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    const staged = Object.assign(new PaymentLinkPayment(), row);

    return run(transactionManager(staged)).then((result) => {
      Object.assign(row, staged);

      return result;
    });
  }

  function transactionManager(staged: PaymentLinkPayment): EntityManager {
    const update = jest.fn().mockImplementation((_target, criteria: number | Partial<PaymentLinkPayment>, values) => {
      const matches = typeof criteria === 'number' || criteria.status == null || criteria.status === staged.status;
      if (matches) Object.assign(staged, values);

      return Promise.resolve({ affected: matches ? 1 : 0 });
    });

    managerUpdates.push(update);

    const manager = { update } as unknown as EntityManager;
    managers.push(manager);

    return manager;
  }

  /**
   * The managers handed to the transitions, in order. An effect reached through anything else is
   * a statement of its own: it commits whether the transition does or not, which is the half-state
   * the transaction exists to rule out — and nothing about the effect itself shows which it was.
   */
  let managers: EntityManager[];

  /** Every statement any transition ran, in order, as [criteria, values]. */
  function transitions(): [Partial<PaymentLinkPayment>, Partial<PaymentLinkPayment>][] {
    return managerUpdates.flatMap((update) =>
      update.mock.calls.map(([, criteria, values]) => [criteria, values] as [never, never]),
    );
  }

  let managerUpdates: jest.Mock[];

  beforeEach(() => {
    // The delivery reads `Config.payment.timeoutDelay` on every tick, deliberately: the span it
    // reaches back over follows the configured delay rather than a copy taken at construction.
    new ConfigService(GetConfig());

    row = payment({ id: 7 });
    rows = [];
    managerUpdates = [];
    managers = [];

    paymentLinkPaymentRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((entity) => entity),
      manager: { transaction: jest.fn().mockImplementation(transaction) },
    } as unknown as jest.Mocked<PaymentLinkPaymentRepository>;

    paymentWebhookService = { sendWebhook: jest.fn() } as unknown as jest.Mocked<PaymentWebhookService>;

    paymentQuoteService = { cancelAllForPayment: jest.fn() } as unknown as jest.Mocked<PaymentQuoteService>;

    paymentActivationService = { closeAllForPayment: jest.fn() } as unknown as jest.Mocked<PaymentActivationService>;

    service = new PaymentLinkPaymentService(
      {} as unknown as jest.Mocked<FiatService>,
      paymentLinkPaymentRepo,
      paymentWebhookService,
      paymentQuoteService,
      paymentActivationService,
      {} as unknown as jest.Mocked<BlockchainRegistryService>,
    );

    sockets = new Set();
    service.useDeviceSource(() => [...sockets].map((id) => ({ id })));
  });

  afterEach(() => {
    // Set by the test that raises it; left behind it would silently widen every later read.
    delete process.env.PAYMENT_TIMEOUT_DELAY;
  });

  // --- deliverPaymentUpdates() Tests --- //

  describe('deliverPaymentUpdates()', () => {
    it('should release a caller waiting here on a payment another process wrote', async () => {
      const waiting = service.waitForPayment(payment({ id: 7 }));

      // Nothing in this process wrote the payment, so nothing in this process released the caller.
      expect(await delivery(waiting)).toEqual('nothing delivered');

      paymentLinkPaymentRepo.find.mockResolvedValue([payment({ id: 7, status: PaymentLinkPaymentStatus.COMPLETED })]);
      await service.deliverPaymentUpdates();

      expect(await delivery(waiting)).toMatchObject({ id: 7, status: PaymentLinkPaymentStatus.COMPLETED });
    });

    it('should release a caller on a MULTIPLE-mode payment that stays pending', async () => {
      const waiting = service.waitForPayment(payment({ id: 7, mode: PaymentLinkPaymentMode.MULTIPLE, txCount: 1 }));

      paymentLinkPaymentRepo.find.mockResolvedValue([
        payment({ id: 7, mode: PaymentLinkPaymentMode.MULTIPLE, txCount: 2 }),
      ]);
      await service.deliverPaymentUpdates();

      expect(await delivery(waiting)).toMatchObject({ id: 7, txCount: 2 });
    });

    it('should keep waiting while the payment is unchanged', async () => {
      const waiting = service.waitForPayment(payment({ id: 7 }));

      paymentLinkPaymentRepo.find.mockResolvedValue([payment({ id: 7 })]);
      await service.deliverPaymentUpdates();

      expect(await delivery(waiting)).toEqual('nothing delivered');
    });

    it('should not touch the database while this process holds neither a caller nor a device', async () => {
      await service.deliverPaymentUpdates();

      expect(paymentLinkPaymentRepo.find).not.toHaveBeenCalled();
    });

    it('should ask only for the payments this process is waiting on', async () => {
      void service.waitForPayment(payment({ id: 7 }));

      await service.deliverPaymentUpdates();

      expect(paymentLinkPaymentRepo.find).toHaveBeenCalledTimes(1);
      expect(paymentLinkPaymentRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: In([7]) } }));
    });

    it('should send the command to a device connected here after another process wrote the payment', async () => {
      const seen = devices();
      connect('pos-1');

      paymentLinkPaymentRepo.find.mockResolvedValue([
        payment({
          id: 7,
          status: PaymentLinkPaymentStatus.COMPLETED,
          deviceId: 'pos-1',
          deviceCommand: 'show-paid',
        }),
      ]);
      await service.deliverPaymentUpdates();

      expect(seen).toEqual([{ id: 'pos-1', command: 'show-paid' }]);
    });

    it('should send the same payment state to a device once', async () => {
      // The window admits the same payment on every tick it spans, so what keeps the command from
      // being repeated is the record of what was sent, not the read.
      const seen = devices();
      connect('pos-1');

      paymentLinkPaymentRepo.find.mockResolvedValue([
        payment({
          id: 7,
          status: PaymentLinkPaymentStatus.COMPLETED,
          deviceId: 'pos-1',
          deviceCommand: 'show-paid',
        }),
      ]);
      await service.deliverPaymentUpdates();
      await service.deliverPaymentUpdates();

      expect(seen).toHaveLength(1);
    });

    it('should send both payments of a device that carry the same state', async () => {
      // One slot per device could hold only the later of the two, and the next tick would then find
      // the earlier one undelivered again — the two would take turns evicting each other for as
      // long as the window spans both.
      const seen = devices();
      connect('pos-1');

      const paid = (id: number) =>
        payment({ id, status: PaymentLinkPaymentStatus.COMPLETED, deviceId: 'pos-1', deviceCommand: 'show-paid' });

      paymentLinkPaymentRepo.find.mockResolvedValue([paid(7), paid(8)]);
      await service.deliverPaymentUpdates();
      await service.deliverPaymentUpdates();

      expect(seen).toHaveLength(2);
    });

    it('should stop looking for a device the moment the gateway no longer holds it', async () => {
      // Nothing tells the service the device went away, and nothing has to: it reads the connected
      // devices on every delivery, so a device that is gone simply stops appearing.
      connect('pos-1');

      await service.deliverPaymentUpdates();
      expect(paymentLinkPaymentRepo.find).toHaveBeenCalledTimes(1);

      sockets.delete('pos-1');

      await service.deliverPaymentUpdates();
      expect(paymentLinkPaymentRepo.find).toHaveBeenCalledTimes(1);
    });

    it('should ask for every connected device in one read, on one cutoff', async () => {
      // The cutoff is a property of the payments, not of the connections, so there is nothing left
      // for a per-device clause to express — and one clause per device is what made the read grow
      // with the number of connections.
      connect('pos-1');
      connect('pos-2');

      await service.deliverPaymentUpdates();

      const { where } = paymentLinkPaymentRepo.find.mock.calls[0][0];
      const clauses = where as { deviceId: { value: string[] }; expiryDate: { value: Date } }[];

      expect(clauses).toHaveLength(2);
      for (const clause of clauses) {
        expect(clause.deviceId.value).toEqual(['pos-1', 'pos-2']);
        expect(clause.expiryDate.value).toEqual(clauses[0].expiryDate.value);
      }
    });

    it('should reach back past the delay before an expiry is even acted on', async () => {
      // processExpiredPayments expires a payment at its expiryDate PLUS this delay, so a cutoff
      // measured from the expiryDate alone would drop the payment out of the read before the
      // transition it is waiting for has happened. Reading the configured value rather than
      // assuming it is what keeps that true when the value changes.
      process.env.PAYMENT_TIMEOUT_DELAY = '3600';
      new ConfigService(GetConfig());
      connect('pos-1');

      await service.deliverPaymentUpdates();

      const { where } = paymentLinkPaymentRepo.find.mock.calls[0][0];
      const [clause] = where as { expiryDate: { value: Date } }[];

      expect(clause.expiryDate.value.getTime()).toBeLessThan(Util.minutesBefore(60).getTime());
    });

    it('should still deliver a payment whose write was outlived by the read beside it', async () => {
      // The failure this replaces: a read bounded by `updated` asks for a span before the present,
      // and a transaction that stays open longer than that span commits a row whose stamp is
      // already past the far end — it is never read again. Selecting on a column no later write
      // moves cannot do that: a late commit makes the row appear later, never skip.
      const seen = devices();
      connect('pos-1');
      paymentLinkPaymentRepo.find.mockImplementation(async (options) => findByCutoff(options));

      rows = [
        payment({
          id: 7,
          status: PaymentLinkPaymentStatus.COMPLETED,
          deviceId: 'pos-1',
          deviceCommand: 'show-paid',
          // Stamped by a transaction that then took an hour to commit.
          updated: Util.minutesBefore(60),
          expiryDate: Util.minutesAfter(5),
        }),
      ];
      await service.deliverPaymentUpdates();

      expect(seen).toEqual([{ id: 'pos-1', command: 'show-paid' }]);
    });

    it('should owe a reconnecting device exactly what it was owed before', async () => {
      // A record tied to the connection is lost with it, and the read then starts at the new
      // connection time: what completed just before the reconnect falls between the two and is
      // never delivered, while everything before it is delivered again.
      const seen = devices();
      connect('pos-1');
      paymentLinkPaymentRepo.find.mockImplementation(async (options) => findByCutoff(options));

      const paid = (id: number) =>
        payment({
          id,
          status: PaymentLinkPaymentStatus.COMPLETED,
          deviceId: 'pos-1',
          deviceCommand: 'show-paid',
        });

      rows = [paid(7)];
      await service.deliverPaymentUpdates();
      expect(seen).toHaveLength(1);

      sockets.delete('pos-1');
      // Completes while nothing is connected for it.
      rows = [paid(7), paid(8)];
      await service.deliverPaymentUpdates();

      connect('pos-1');
      await service.deliverPaymentUpdates();

      // The one it missed, and only that one: the payment of the first tick is not repeated.
      expect(seen).toHaveLength(2);
    });

    it('should still deliver a payment that becomes visible after one stamped alike', async () => {
      // A payment carries the stamp its write gave it and appears only once that write commits, so
      // a read running beside it sees the stamp of a row it cannot see yet. A mark advanced to the
      // newest stamp read would ask for something strictly newer on the next tick and never see
      // that row at all.
      const seen = devices();
      connect('pos-1');
      paymentLinkPaymentRepo.find.mockImplementation(async (options) => findByCutoff(options));

      const updated = Util.secondsBefore(1);
      const paid = (id: number) =>
        payment({
          id,
          status: PaymentLinkPaymentStatus.COMPLETED,
          deviceId: 'pos-1',
          deviceCommand: 'show-paid',
          updated,
        });

      rows = [paid(7)];
      await service.deliverPaymentUpdates();
      expect(seen).toHaveLength(1);

      // The slower write commits. Its row was stamped at the same moment as the one already read.
      rows = [paid(7), paid(8)];
      await service.deliverPaymentUpdates();

      // Delivered — and the payment of the first tick was not sent a second time.
      expect(seen).toHaveLength(2);
    });

    it('should keep owing a command whose send did not get out', async () => {
      // The loss this closes: the record is keyed by DEVICE and outlives the connection, so a
      // command marked delivered before a failing send would never be retried — not even when
      // the device reconnects, because the record still says it heard this state. Recording only
      // what got out is what keeps the periodic delivery able to repair it.
      const seen = devices(false);
      connect('pos-1');
      paymentLinkPaymentRepo.find.mockImplementation(async (options) => findByCutoff(options));

      rows = [
        payment({
          id: 7,
          status: PaymentLinkPaymentStatus.COMPLETED,
          deviceId: 'pos-1',
          deviceCommand: 'show-paid',
        }),
      ];

      await service.deliverPaymentUpdates();
      expect(seen).toHaveLength(1);
      // Nothing got out, so nothing is recorded.
      expect(service['deviceDeliveries'].get('pos-1')?.size ?? 0).toEqual(0);

      // The next tick tries again — which is the whole point.
      await service.deliverPaymentUpdates();
      expect(seen).toHaveLength(2);
    });

    it('should stop repeating once a command does get out', async () => {
      // The other direction: a sink that takes it must end the repetition, or the fix above would
      // have traded a silent loss for an endless one.
      const seen = devices();
      connect('pos-1');
      paymentLinkPaymentRepo.find.mockImplementation(async (options) => findByCutoff(options));

      rows = [
        payment({
          id: 7,
          status: PaymentLinkPaymentStatus.COMPLETED,
          deviceId: 'pos-1',
          deviceCommand: 'show-paid',
        }),
      ];

      await service.deliverPaymentUpdates();
      await service.deliverPaymentUpdates();

      expect(seen).toHaveLength(1);
    });

    it('should forget a payment the read has left behind, and the device with its last one', async () => {
      // What bounds the record is the same cutoff the query uses: a payment the read can no longer
      // return cannot be delivered again, so nothing is kept for it. Without that, a device
      // connected all day would accumulate an entry per payment it ever saw — and a device that
      // never comes back would keep a map of its own for good.
      connect('pos-1');
      // A sink that takes it: the record is only written for a command that got out.
      devices();
      paymentLinkPaymentRepo.find.mockImplementation(async (options) => findByCutoff(options));

      // Delivered directly by the writing process, which does not consult the cutoff.
      rows = [];
      service['deliverToDevice'](
        payment({
          id: 7,
          status: PaymentLinkPaymentStatus.COMPLETED,
          deviceId: 'pos-1',
          deviceCommand: 'show-paid',
          // Its own end is long past, and past the grace that follows it.
          expiryDate: Util.hoursBefore(2),
        }),
      );
      expect(service['deviceDeliveries'].get('pos-1').size).toEqual(1);

      await service.deliverPaymentUpdates();

      expect(service['deviceDeliveries'].has('pos-1')).toBe(false);
    });

    it('should agree with the read at the exact boundary', () => {
      // Record and read must decide "still owed?" identically, including AT the cutoff: the read
      // uses MoreThan, so a payment sitting exactly on it is no longer returned — and its entry
      // has to go with it. An entry one millisecond inside stays. If the two comparators ever
      // drift apart, one side re-sends what the other considers settled.
      const cutoff = new Date();
      service['deviceDeliveries'].set(
        'pos-1',
        new Map([
          [1, { state: 'x', expiryDate: cutoff }],
          [2, { state: 'y', expiryDate: new Date(cutoff.getTime() + 1) }],
        ]),
      );

      service['pruneDeliveries'](cutoff);

      expect([...service['deviceDeliveries'].get('pos-1').keys()]).toEqual([2]);
    });
  });

  // --- waitForPayment() Tests --- //

  describe('waitForPayment()', () => {
    it('should answer with the payment on hand once the wait elapses', async () => {
      // The endpoints keep their shape: a caller that is still there is told what the payment looks
      // like now, which for a pending one means "not yet, ask again".
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        const pending = payment({ id: 7 });
        const waiting = service.waitForPayment(pending);

        jest.advanceTimersByTime(60_000);

        await expect(waiting).resolves.toBe(pending);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should leave nothing behind when the wait elapses', async () => {
      // The reason the wait is bounded at all. A client that hangs up says nothing the server can
      // hear, so an unbounded wait left both entries in place for the lifetime of the process.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        const waiting = service.waitForPayment(payment({ id: 7 }));

        jest.advanceTimersByTime(60_000);
        await waiting;

        expect(service['waitStates'].size).toEqual(0);
        expect(service['paymentWaitMap'].get()).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should keep the compared state while a wait on the same payment is still registered', async () => {
      // Two callers share one entry, so the one leaving must not take the state the other is
      // comparing against with it.
      const first = service.waitForPayment(payment({ id: 7 }));
      void service.waitForPayment(payment({ id: 7 }));

      paymentLinkPaymentRepo.find.mockResolvedValue([payment({ id: 7, status: PaymentLinkPaymentStatus.COMPLETED })]);
      await service.deliverPaymentUpdates();

      await expect(first).resolves.toMatchObject({ status: PaymentLinkPaymentStatus.COMPLETED });
    });
  });

  // --- doSave() Tests --- //

  describe('doSave()', () => {
    it('should release a caller in the writing process without waiting for the job', async () => {
      const pending = payment({ id: 7, deviceId: 'pos-1', deviceCommand: 'show-paid' });
      const seen = devices();
      connect('pos-1');

      const waiting = service.waitForPayment(pending);
      await service.expirePayment(pending);

      expect(await delivery(waiting)).toMatchObject({ id: 7, status: PaymentLinkPaymentStatus.EXPIRED });
      expect(seen).toEqual([{ id: 'pos-1', command: 'show-paid' }]);
    });

    it('should not repeat a delivery the writing process already made', async () => {
      const pending = payment({ id: 7, deviceId: 'pos-1', deviceCommand: 'show-paid' });
      const seen = devices();
      connect('pos-1');

      await service.expirePayment(pending);

      paymentLinkPaymentRepo.find.mockResolvedValue([pending]);
      await service.deliverPaymentUpdates();

      expect(seen).toHaveLength(1);
    });
  });

  // --- Leaving Pending --- //

  /**
   * Leaving `Pending` has to be decided by the database, not by a status read a moment earlier.
   * The expiry job is a `Worker` job, the expiry timers stay in the process that served the
   * request, and cancelling and completing arrive from request paths — so several processes can
   * hold the same payment as `Pending` at the same time, and each of them would send the merchant
   * its webhook and cancel the quotes again.
   *
   * A row that no longer reads `Pending` is what a caller that lost meets, and it is the whole
   * assertion: nothing after the transition may happen for it.
   */
  describe('leaving Pending', () => {
    it('should expire through a conditional update rather than a status read', async () => {
      await service.expirePayment(payment({ id: 7 }));

      expect(transitions()).toEqual([
        [{ id: 7, status: PaymentLinkPaymentStatus.PENDING }, { status: PaymentLinkPaymentStatus.EXPIRED }],
      ]);
    });

    it('should run the effects of an expiry on the manager of its transition', async () => {
      // The effects are what the transition carries with it. Reached through the repository's own
      // manager instead, they would be statements outside it: committed while the status update
      // rolls back, or committed after it and lost when the caller stops in between.
      await service.expirePayment(payment({ id: 7 }));

      expect(managers).toHaveLength(1);
      expect(paymentQuoteService.cancelAllForPayment).toHaveBeenCalledWith(7, managers[0]);
      expect(paymentActivationService.closeAllForPayment).toHaveBeenCalledWith(7, managers[0]);
    });

    it('should not expire a second time when another process took the transition', async () => {
      row.status = PaymentLinkPaymentStatus.EXPIRED;

      await service.expirePayment(payment({ id: 7, link: { webhookUrl: 'https://merchant.example/hook' } as never }));

      expect(paymentWebhookService.sendWebhook).not.toHaveBeenCalled();
      expect(paymentQuoteService.cancelAllForPayment).not.toHaveBeenCalled();
      expect(paymentActivationService.closeAllForPayment).not.toHaveBeenCalled();
      expect(paymentLinkPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('should cancel through the same transition', async () => {
      await service.cancelByPayment(payment({ id: 7 }));

      expect(transitions()).toEqual([
        [{ id: 7, status: PaymentLinkPaymentStatus.PENDING }, { status: PaymentLinkPaymentStatus.CANCELLED }],
      ]);
      expect(managers).toHaveLength(1);
      expect(paymentQuoteService.cancelAllForPayment).toHaveBeenCalledWith(7, managers[0]);
      expect(paymentActivationService.closeAllForPayment).toHaveBeenCalledWith(7, managers[0]);
    });

    it('should not cancel a payment the worker expired in between', async () => {
      row.status = PaymentLinkPaymentStatus.EXPIRED;

      await service.cancelByPayment(payment({ id: 7, link: { webhookUrl: 'https://merchant.example/hook' } as never }));

      expect(paymentWebhookService.sendWebhook).not.toHaveBeenCalled();
      expect(paymentQuoteService.cancelAllForPayment).not.toHaveBeenCalled();
      expect(paymentLinkPaymentRepo.save).not.toHaveBeenCalled();
    });

    /**
     * What a transition costs when it commits on its own: the row leaves `Pending` and the effects
     * that belong to it do not follow. `processExpiredPayments` asks for `Pending`, so such a row
     * is out of reach of every job — it is not a delayed repair but a permanent half-state.
     */
    describe('a caller that stops between the transition and its effects', () => {
      /** The payments the expiry job would find on its next run. */
      function pendingPayments(): PaymentLinkPayment[] {
        return row.status === PaymentLinkPaymentStatus.PENDING ? [row] : [];
      }

      beforeEach(() => {
        // The real job runs here: what makes the half-state permanent is its own query.
        new ConfigService(GetConfig());
        paymentLinkPaymentRepo.find.mockImplementation(async () => pendingPayments());
      });

      it('should ask for nothing but Pending, which is why a half-state is out of its reach', async () => {
        await service.processExpiredPayments();

        expect(paymentLinkPaymentRepo.find).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ status: PaymentLinkPaymentStatus.PENDING }),
          }),
        );
      });

      it('should leave the payment where the next run of the job picks it up', async () => {
        paymentQuoteService.cancelAllForPayment.mockRejectedValue(new Error('connection reset'));

        await expect(service.processExpiredPayments()).rejects.toThrow('connection reset');

        // Not expired, and its quotes are not cancelled either: both or neither.
        expect(row.status).toEqual(PaymentLinkPaymentStatus.PENDING);
        expect(paymentActivationService.closeAllForPayment).not.toHaveBeenCalled();

        // And the next run finds it, which is the property the whole transition rests on.
        paymentQuoteService.cancelAllForPayment.mockResolvedValue(undefined);
        await service.processExpiredPayments();

        expect(row.status).toEqual(PaymentLinkPaymentStatus.EXPIRED);
        expect(paymentActivationService.closeAllForPayment).toHaveBeenCalledTimes(1);
      });

      it('should have cancelled the quotes before anything a merchant can hold up', async () => {
        // The webhook is the one effect that stays outside the transaction, so it must be the last
        // one: a payment whose merchant call fails is finished in the database all the same.
        paymentLinkPaymentRepo.save.mockRejectedValue(new Error('merchant unreachable'));

        await expect(service.processExpiredPayments()).rejects.toThrow('merchant unreachable');

        expect(row.status).toEqual(PaymentLinkPaymentStatus.EXPIRED);
        expect(paymentQuoteService.cancelAllForPayment).toHaveBeenCalledTimes(1);
        expect(paymentActivationService.closeAllForPayment).toHaveBeenCalledTimes(1);

        // Nothing left over: the job does not see it again, and does not have to.
        expect(pendingPayments()).toEqual([]);
      });
    });

    /** The third way out of `Pending`, reached from a request path and from checkTxConfirmations. */
    describe('completing on a quote', () => {
      function completing(values: Partial<PaymentLinkPayment> = {}): PaymentLinkPayment {
        return payment({
          id: 7,
          link: { configObj: { minCompletionStatus: PaymentQuoteStatus.TX_MEMPOOL } } as never,
          ...values,
        });
      }

      const quote = { id: 3, status: PaymentQuoteStatus.TX_MEMPOOL } as PaymentQuote;

      beforeEach(() => {
        paymentQuoteService.getCompletedQuoteCount = jest.fn().mockResolvedValue(1);
        paymentActivationService.closeAllForQuote = jest.fn();
      });

      it('should complete a SINGLE payment through the transition', async () => {
        await service['handleQuoteChange'](completing(), quote);

        expect(transitions()).toEqual([
          [{ id: 7, status: PaymentLinkPaymentStatus.PENDING }, { status: PaymentLinkPaymentStatus.COMPLETED }],
          [7, { txCount: 1 }],
        ]);
        // Both statements on the one manager the transition was given: a count written through a
        // second transaction would commit on its own, which is what carrying it here rules out.
        expect(managers).toHaveLength(1);
        expect(managers[0].update).toHaveBeenCalledTimes(2);
        expect(paymentLinkPaymentRepo.save).toHaveBeenCalledTimes(1);
      });

      it('should close the activations inside the transition, not before it', async () => {
        // The half-state nothing can repair: activations closed while the payment is still
        // `Pending`. The quote is already final, so checkTxConfirmations does not come back to
        // it, and processExpiredPayments only ever asks for `Pending` — it would expire a payment
        // whose activations have been closed for good. Running the close on the transition's own
        // manager is what ties the two together.
        await service['handleQuoteChange'](completing(), quote);

        expect(paymentActivationService.closeAllForPayment).toHaveBeenCalledWith(7, managers[0]);
      });

      it('should leave the activations open when the transition is lost', async () => {
        // Another process took the payment out of `Pending` first. Then this caller performs no
        // effect at all — closing activations for a transition it did not win would be the same
        // half-state seen from the other side.
        row.status = PaymentLinkPaymentStatus.COMPLETED;

        await service['handleQuoteChange'](completing(), quote);

        expect(paymentActivationService.closeAllForPayment).not.toHaveBeenCalled();
        expect(paymentLinkPaymentRepo.save).not.toHaveBeenCalled();
      });

      it('should still close the activations on the paths that take no transition', async () => {
        // A payment that is no longer `Pending` has nothing to transition, but its final quote's
        // activations still have to be closed — that path predates the transaction and stays.
        const payment = completing();
        payment.status = PaymentLinkPaymentStatus.EXPIRED;

        await service['handleQuoteChange'](payment, quote);

        expect(paymentActivationService.closeAllForPayment).toHaveBeenCalledWith(7, undefined);
        expect(transitions()).toEqual([]);
      });

      it('should carry the counted quotes into the transition, not only into the save after it', async () => {
        // A completed payment is looked at by no job, so a count left behind by a caller that
        // stopped after the transition would stay wrong for good.
        paymentLinkPaymentRepo.save.mockRejectedValue(new Error('merchant unreachable'));

        await expect(service['handleQuoteChange'](completing(), quote)).rejects.toThrow('merchant unreachable');

        expect(row.status).toEqual(PaymentLinkPaymentStatus.COMPLETED);
        expect(row.txCount).toEqual(1);
      });

      it('should not complete it again when another process got there first', async () => {
        row.status = PaymentLinkPaymentStatus.COMPLETED;

        await service['handleQuoteChange'](completing(), quote);

        expect(paymentLinkPaymentRepo.save).not.toHaveBeenCalled();
      });

      it('should count a MULTIPLE payment without taking a transition', async () => {
        // It stays `Pending`, so there is nothing to claim — and claiming would keep every process
        // but one from recording the quote it counted.
        await service['handleQuoteChange'](completing({ mode: PaymentLinkPaymentMode.MULTIPLE }), quote);

        expect(transitions()).toEqual([]);
        expect(paymentLinkPaymentRepo.save).toHaveBeenCalledTimes(1);
      });
    });
  });
});
