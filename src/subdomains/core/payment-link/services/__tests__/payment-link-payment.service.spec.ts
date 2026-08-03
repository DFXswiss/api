import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { In } from 'typeorm';
import { PaymentDevice, PaymentLinkPayment } from '../../entities/payment-link-payment.entity';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus } from '../../enums';
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

  function payment(values: Partial<PaymentLinkPayment>): PaymentLinkPayment {
    return Object.assign(new PaymentLinkPayment(), {
      id: 7,
      status: PaymentLinkPaymentStatus.PENDING,
      mode: PaymentLinkPaymentMode.SINGLE,
      txCount: 0,
      updated: new Date('2026-01-01T10:00:00Z'),
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

  function devices(): PaymentDevice[] {
    const seen: PaymentDevice[] = [];
    service.getDeviceActivationObservable().subscribe((device) => seen.push(device));

    return seen;
  }

  /**
   * Stands in for the gateway's socket map. The service reads the connected devices out of it on
   * every delivery, so a device is connected here for exactly as long as this map says so — there
   * is no register in the service to register with.
   */
  let sockets: Map<string, Date>;

  function connect(deviceId: string, since = new Date('2026-01-01T09:00:00Z')): void {
    sockets.set(deviceId, since);
  }

  beforeEach(() => {
    paymentLinkPaymentRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((entity) => entity),
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

    sockets = new Map();
    service.useDeviceSource(() => [...sockets].map(([id, since]) => ({ id, since })));
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
          updated: new Date('2026-01-01T11:00:00Z'),
        }),
      ]);
      await service.deliverPaymentUpdates();

      expect(seen).toEqual([{ id: 'pos-1', command: 'show-paid' }]);
    });

    it('should send the same payment state to a device once', async () => {
      const seen = devices();
      connect('pos-1');

      paymentLinkPaymentRepo.find.mockResolvedValue([
        payment({
          id: 7,
          status: PaymentLinkPaymentStatus.COMPLETED,
          deviceId: 'pos-1',
          deviceCommand: 'show-paid',
          updated: new Date('2026-01-01T11:00:00Z'),
        }),
      ]);
      await service.deliverPaymentUpdates();
      await service.deliverPaymentUpdates();

      expect(seen).toHaveLength(1);
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

    it('should ask each device for its own window, not for the oldest one of all', async () => {
      // A single minimum across all devices lets the quietest one set the window for everyone: the
      // busy device is then re-read from the point the quiet one connected, on every tick.
      const seen = devices();
      connect('pos-1', new Date('2026-01-01T09:00:00Z'));

      paymentLinkPaymentRepo.find.mockResolvedValue([
        payment({
          id: 7,
          status: PaymentLinkPaymentStatus.COMPLETED,
          deviceId: 'pos-1',
          deviceCommand: 'show-paid',
          updated: new Date('2026-01-01T11:00:00Z'),
        }),
      ]);
      await service.deliverPaymentUpdates();
      expect(seen).toHaveLength(1);

      // A second device joins, connected long before anything happened on the first one.
      connect('pos-2', new Date('2026-01-01T08:00:00Z'));
      paymentLinkPaymentRepo.find.mockClear();
      await service.deliverPaymentUpdates();

      const { where } = paymentLinkPaymentRepo.find.mock.calls[0][0];
      const windows = new Map((where as { deviceId: string; updated: { value: Date } }[]).map((w) => [w.deviceId, w]));

      // The device that was already delivered to has moved on; the newcomer starts at its own
      // connection time. One shared window could not express both.
      expect(windows.get('pos-1').updated.value).toEqual(new Date('2026-01-01T11:00:00Z'));
      expect(windows.get('pos-2').updated.value).toEqual(new Date('2026-01-01T08:00:00Z'));
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
});
