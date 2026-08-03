import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { Config, Environment } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { LnurlpInvoiceDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { AsyncMap } from 'src/shared/utils/async-map';
import { Util } from 'src/shared/utils/util';
import { C2BWebhookResult } from 'src/subdomains/core/payment-link/share/c2b-payment-link.provider';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { EntityManager, In, IsNull, LessThan, MoreThan, Not } from 'typeorm';
import { isSellRoute } from '../../sell-crypto/route/sell.entity';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { PaymentLinkEvmPaymentDto, PaymentLinkHexResultDto, TransferInfo } from '../dto/payment-link.dto';
import { PaymentRequestMapper } from '../dto/payment-request.mapper';
import { UpdatePaymentLinkPaymentDto } from '../dto/update-payment-link-payment.dto';
import { PaymentDevice, PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentQuote } from '../entities/payment-quote.entity';
import {
  PaymentLinkMode,
  PaymentLinkPaymentMode,
  PaymentLinkPaymentStatus,
  PaymentLinkStatus,
  PaymentQuoteFinalStates,
  PaymentQuoteStatus,
  PaymentQuoteTxStates,
} from '../enums';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';
import { PaymentActivationService } from './payment-activation.service';
import { PaymentQuoteService } from './payment-quote.service';
import { PaymentWebhookService } from './payment-webhook.service';

/**
 * How long a caller of `waitForPayment` is held before it is answered with the state on hand.
 *
 * A server-side long poll without an upper bound leaks by construction: a client that hangs up
 * says nothing the server can hear, so its entry would sit in the maps below until the process
 * restarts. The bound is what gives the entry an owner — with it, the waiter itself clears the
 * entry on the way out, whichever way it leaves.
 *
 * The endpoints answering from this do not change shape when it elapses; they answer with the
 * payment as it stands, which for a caller that is still there means "not yet, ask again".
 */
const PAYMENT_WAIT_TIMEOUT_SECONDS = 60;

/** A device this process holds at least one open websocket connection for. */
export interface ConnectedDevice {
  id: string;
  /** When the oldest connection still open for this device was accepted. */
  since: Date;
}

/**
 * How far back the delivery read below looks, per device.
 *
 * What it replaces is a mark that advanced to the newest `updated` it had read. A row carries the
 * stamp the writing statement gave it and becomes readable only when that write commits, so a mark
 * moved past the stamp of a row that had not committed yet asks for `updated > since` and never
 * sees that row again — the notification is not late, it is gone. Two rows stamped alike are the
 * plainest case of it, but any write outlived by the read that ran beside it does the same.
 *
 * A span measured against the present cannot skip a row that way: it only has to outlast the gap
 * between a payment's stamp and its commit, which for the transitions in this service is one
 * statement plus the effects that travel with it. It is also what bounds the read — see
 * `windowStart`.
 */
const DEVICE_DELIVERY_WINDOW_SECONDS = 60;

/**
 * What this process has delivered to one device: per payment, the wait state last sent for it and
 * the `updated` that state was read at. Never a record of who is connected — see `connectedDevices`.
 */
type DeviceDeliveries = Map<number, { state: string; updated: Date }>;

@Injectable()
export class PaymentLinkPaymentService {
  private readonly paymentWaitMap = new AsyncMap<number, PaymentLinkPayment>(this.constructor.name);
  private readonly waitStates = new Map<number, string>();
  private readonly deviceActivationSubject = new Subject<PaymentDevice>();
  private readonly deviceDeliveries = new Map<string, DeviceDeliveries>();

  /**
   * Where the connected devices are READ from — set once by PaymentLinkGateway, which owns the
   * sockets.
   *
   * A device is connected for exactly as long as the gateway holds a socket for it, so the socket
   * map is the only thing that knows. Reading through to it beats having the gateway report
   * connects and disconnects into a second map here: a mirrored register can drift from what it
   * mirrors, and every way it drifted was a defect — an entry left behind when no close event
   * arrived, a count decremented twice by a close path taken twice, an entry with no counterpart.
   * A derived register has no second copy to get out of step with.
   *
   * Empty until the gateway sets it, which is also the honest answer for a process that accepts no
   * websocket connections at all.
   */
  private connectedDevices: () => ConnectedDevice[] = () => [];

  constructor(
    private readonly fiatService: FiatService,
    private readonly paymentLinkPaymentRepo: PaymentLinkPaymentRepository,
    private readonly paymentWebhookService: PaymentWebhookService,
    private readonly paymentQuoteService: PaymentQuoteService,
    private readonly paymentActivationService: PaymentActivationService,
    private readonly blockchainRegistryService: BlockchainRegistryService,
  ) {}

  getDeviceActivationObservable(): Observable<PaymentDevice> {
    return this.deviceActivationSubject.asObservable();
  }

  // --- JOBS --- //
  async processExpiredPayments(): Promise<void> {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    const pendingPayments = await this.paymentLinkPaymentRepo.find({
      where: {
        status: PaymentLinkPaymentStatus.PENDING,
        expiryDate: LessThan(maxDate),
      },
      relations: { link: true },
    });

    for (const payment of pendingPayments) {
      await this.expirePayment(payment);
    }
  }

  async expirePayment(payment: PaymentLinkPayment): Promise<void> {
    const taken = await this.takePendingTransition(payment, PaymentLinkPaymentStatus.EXPIRED, (manager) =>
      this.cancelQuotesForPayment(payment.id, manager),
    );
    if (!taken) return;

    await this.doSave(payment.expire(), true);
  }

  /**
   * Moves a payment out of `Pending` together with the database effects that belong to that
   * transition, and answers whether THIS caller is the one that moved it. Everything that follows
   * — the merchant webhook, the deliveries in `doSave` — belongs to the caller that gets `true`.
   *
   * The read-then-write this replaces was safe while everything ran in one process. It is not any
   * more: `processExpiredPayments` is a `Worker` job, while the expiry timers `createPayment` arms
   * stay in the process that served the request, so two processes can read the same row as
   * `Pending` and both act on it. A lock would not help, because they are different processes, and
   * a lease would not either, because the request paths below reach the same transition without
   * going through a job at all.
   *
   * The `status` in the criteria is what decides it: the database lets exactly one statement past
   * `Pending` and reports it as the affected row, and every other caller gets nothing. That holds
   * for any number of processes and for every path into the transition, which is why it sits here
   * rather than at the call sites.
   *
   * `effects` runs in the same transaction as that statement, so the row leaves `Pending` only if
   * they leave with it. A statement committing on its own would be worse than the double run it
   * prevents: a caller dying between the two would leave a payment out of `Pending` with its
   * quotes still open, and nothing looks for that — `processExpiredPayments` asks for `Pending`
   * and would never see the row again. Rolled back, the payment stays exactly where the next run
   * of the job, or of the timer, picks it up.
   *
   * What stays outside is what a transaction must not hold open: the merchant webhook and the
   * process-local deliveries in `doSave`. Those cost a notification when they are lost, not a row
   * that no one reconciles — and the webhook is best-effort by construction (see
   * `PaymentWebhookService.sendWebhook`).
   */
  private async takePendingTransition(
    payment: PaymentLinkPayment,
    status: PaymentLinkPaymentStatus,
    effects: (manager: EntityManager) => Promise<void>,
  ): Promise<boolean> {
    return this.paymentLinkPaymentRepo.manager.transaction(async (manager) => {
      const { affected } = await manager.update(
        PaymentLinkPayment,
        { id: payment.id, status: PaymentLinkPaymentStatus.PENDING },
        { status },
      );
      if (!affected) return false;

      await effects(manager);

      return true;
    });
  }

  async checkTxConfirmations(): Promise<void> {
    const confirmingQuotes = await this.paymentQuoteService.getConfirmingQuotes();

    for (const quote of confirmingQuotes) {
      const blockchain = quote.txBlockchain;

      if (blockchain) {
        const client = this.blockchainRegistryService.getClient(blockchain);
        const isTxComplete = await client.isTxComplete(quote.txId, Config.payment.minConfirmations(blockchain));

        if (isTxComplete) {
          await this.paymentQuoteService.saveFinallyConfirmed(quote);
          await this.handleQuoteChange(quote.payment, quote);
        }
      }
    }
  }

  // --- CRUD --- //

  async updatePayment(id: number, dto: UpdatePaymentLinkPaymentDto): Promise<PaymentLinkPayment> {
    const entity = await this.paymentLinkPaymentRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Payment not found');

    return this.paymentLinkPaymentRepo.save(Object.assign(entity, dto));
  }

  async getPendingPaymentByUniqueId(uniqueId: string): Promise<PaymentLinkPayment | null> {
    return this.paymentLinkPaymentRepo.findOne({
      where: [
        {
          link: { uniqueId },
          status: PaymentLinkPaymentStatus.PENDING,
        },
        {
          uniqueId,
          status: PaymentLinkPaymentStatus.PENDING,
        },
      ],
      relations: {
        link: { route: { deposit: true, user: { userData: { organization: true } } } },
      },
    });
  }

  // externalPaymentId is a merchant-supplied reconciliation identifier and is NOT unique across
  // merchants; scope the lookup to a link the caller has already been authorized against, or the
  // response leaks foreign merchants' payment records (BUG-1289).
  async getPaymentByExternalId(linkId: number, externalPaymentId: string): Promise<PaymentLinkPayment | null> {
    return this.paymentLinkPaymentRepo.findOne({
      where: { externalId: externalPaymentId, link: { id: linkId } },
    });
  }

  async getMostRecentPayment(uniqueId: string): Promise<PaymentLinkPayment | null> {
    return this.paymentLinkPaymentRepo.findOne({
      where: [
        {
          link: { uniqueId: uniqueId },
        },
        {
          uniqueId: uniqueId,
        },
      ],
      order: { updated: 'DESC' },
    });
  }

  async getMostRecentPayments(linkIds: number[]): Promise<PaymentLinkPayment[]> {
    if (!linkIds.length) return [];

    return this.paymentLinkPaymentRepo
      .createQueryBuilder('plp')
      .innerJoin(
        (qb) =>
          qb
            .select('plp2."linkId"', 'linkId')
            .addSelect('MAX(plp2.id)', 'maxId')
            .from(PaymentLinkPayment, 'plp2')
            .groupBy('plp2."linkId"'),
        'latest',
        'latest."linkId" = plp."linkId" AND latest."maxId" = plp.id',
      )
      .innerJoinAndSelect('plp.currency', 'currency')
      .innerJoinAndSelect('plp.link', 'link')
      .where('link.id IN (:...ids)', { ids: linkIds })
      .getMany();
  }

  // --- HANDLE WAITS --- //

  /**
   * Both delivery channels of this service are process-local: the map behind this method and the
   * subject behind `getDeviceActivationObservable`. A caller therefore only ever hears from the
   * process holding its connection, while the jobs that move a payment forward run in one process
   * (`CronScope.WORKER`, which the deployment runs once and the cron lease keeps to one claim).
   *
   * `deliverPaymentUpdates` below bridges the two. It reads the persisted state of the payments
   * THIS process is waiting on and releases them here, so the delivery no longer depends on which
   * process did the writing. `doSave` still delivers directly, which keeps the single-process
   * case (`CRON_ROLE=all`) as immediate as it is today; the job is the catch-up path for every
   * other process.
   */
  async waitForPayment(payment: PaymentLinkPayment): Promise<PaymentLinkPayment> {
    // The state to compare against, taken before the wait: what the caller is waiting for is a
    // change from it, not a fixed target state (see PaymentLinkPayment.waitState).
    if (!this.waitStates.has(payment.id)) this.waitStates.set(payment.id, payment.waitState);

    try {
      return await this.paymentWaitMap.wait(payment.id, PAYMENT_WAIT_TIMEOUT_SECONDS * 1000);
    } catch {
      // The wait elapsed. Answer with the payment as it stands rather than fail: the caller asked
      // whether anything happened, and "not within this window" is an answer to that.
      return payment;
    } finally {
      // The waiter owns its entry. `resolveWaiters` clears it on the delivery path; this clears it
      // on every other one — which is the path that used to have no owner at all. Guarded on the
      // wait map so a wait registered in the meantime keeps the state it is comparing against.
      if (!this.paymentWaitMap.has(payment.id)) this.waitStates.delete(payment.id);
    }
  }

  /**
   * Points the delivery below at the gateway's socket map; see `connectedDevices`. Called once, by
   * PaymentLinkGateway, which is the only thing that knows what is connected here.
   */
  useDeviceSource(source: () => ConnectedDevice[]): void {
    this.connectedDevices = source;
  }

  /**
   * Delivers what this process is waiting for, from the database rather than from the job that
   * wrote it. Writes nothing and calls nothing outside the process, so it is safe to run in every
   * process at once — which is what `CronScope.BOTH` requires and what makes it exempt from the
   * lease that confines the writing jobs to one process.
   *
   * Both halves are bounded by what this process actually holds: with no caller waiting and no
   * device connected they touch the database not at all.
   *
   * That it reads on a tick rather than subscribing is the choice this makes against CONTRIBUTING's
   * "initial fetch + subscription for real-time data": the only subscription available here is the
   * RxJS subject above, and that reaches no process but this one. A subscription that cannot see
   * the writes it is meant to relay is not one.
   */
  async deliverPaymentUpdates(): Promise<void> {
    await this.deliverToWaitingCallers();
    await this.deliverToConnectedDevices();
  }

  private async deliverToWaitingCallers(): Promise<void> {
    const ids = this.paymentWaitMap.get();
    if (!ids.length) return;

    const payments = await this.paymentLinkPaymentRepo.find({
      where: { id: In(ids) },
      relations: { link: true },
    });

    for (const payment of payments) {
      if (this.waitStates.get(payment.id) !== payment.waitState) this.resolveWaiters(payment);
    }
  }

  private async deliverToConnectedDevices(): Promise<void> {
    const devices = this.connectedDevices();

    // A delivery record is a detail of this process, so it follows the connections rather than
    // outliving them. Pruning here rather than on a disconnect notification is the point: nothing
    // has to be told that a device went away, it simply stops appearing.
    for (const deviceId of this.deviceDeliveries.keys()) {
      if (!devices.some((device) => device.id === deviceId)) this.deviceDeliveries.delete(deviceId);
    }

    if (!devices.length) return;

    // One window PER DEVICE. Taken as a single minimum across all of them, a device that connected
    // moments ago would be read from the point the oldest connection was accepted. The condition
    // inside each window is the one the direct delivery in doSave runs under, expressed over stored
    // columns: a payment out of `Pending`, or a `MULTIPLE`-mode payment that has counted a
    // completed quote.
    const where = devices.flatMap((device) => {
      const since = this.windowStart(device);

      return [
        { deviceId: device.id, updated: MoreThan(since), status: Not(PaymentLinkPaymentStatus.PENDING) },
        { deviceId: device.id, updated: MoreThan(since), txCount: MoreThan(0) },
      ];
    });

    const payments = await this.paymentLinkPaymentRepo.find({ where, order: { updated: 'ASC' } });

    for (const payment of payments) this.deliverToDevice(payment);
  }

  /**
   * Where the read for one device starts: a fixed span before now, and never before its oldest open
   * connection was accepted — nothing older than that connection is this process's to deliver.
   *
   * The span is the same on every tick, so the read stays the same size however long the connection
   * lives, whether or not anything happens on it. What the window admits twice, the record below
   * answers for; what it lets past its far end can no longer come back from the read, so the record
   * of it goes too. That is what bounds the record: not a cap on its size, but the same window that
   * bounds the query.
   */
  private windowStart(device: ConnectedDevice): Date {
    const windowStart = Util.secondsBefore(DEVICE_DELIVERY_WINDOW_SECONDS);
    const since = device.since > windowStart ? device.since : windowStart;

    const delivered = this.deliveriesFor(device.id);
    for (const [paymentId, entry] of delivered) {
      if (!(entry.updated > since)) delivered.delete(paymentId);
    }

    return since;
  }

  /** What has been delivered to a device so far, empty for one nothing has been sent to yet. */
  private deliveriesFor(deviceId: string): DeviceDeliveries {
    const delivered = this.deviceDeliveries.get(deviceId) ?? new Map();
    this.deviceDeliveries.set(deviceId, delivered);

    return delivered;
  }

  private resolveWaiters(payment: PaymentLinkPayment): void {
    this.waitStates.delete(payment.id);
    this.paymentWaitMap.resolve(payment.id, payment);
  }

  /**
   * Idempotent by the state it delivers: a device is sent the same command for the same payment
   * state once, whether this process wrote it or read it back. Both callers go through here.
   */
  private deliverToDevice(payment: PaymentLinkPayment): void {
    const device = payment.device;
    if (!device) return;

    const connected = this.connectedDevices().find((d) => d.id === device.id);
    if (!connected) return;

    // Per payment rather than one slot per device: the window above holds several payments of the
    // same device at once, and a single slot would let two of them take turns evicting each other.
    const delivered = this.deliveriesFor(connected.id);
    if (delivered.get(payment.id)?.state === payment.waitState) return;

    delivered.set(payment.id, { state: payment.waitState, updated: payment.updated });

    this.deviceActivationSubject.next(device);
  }

  async handleBinanceWaiting(result: C2BWebhookResult): Promise<void> {
    const { qrContent, referId } = result.metadata;

    const lnurl = new URL(qrContent).searchParams.get('lightning');
    const uniqueId = LightningHelper.decodeLnurl(lnurl).split('/').at(-1);
    const payment = await this.getPendingPaymentByUniqueId(uniqueId);
    if (!payment) throw new NotFoundException('Payment not found');

    const quote = await this.paymentQuoteService.createQuote(payment.link.defaultStandard, payment);
    const transferAmount = JSON.parse(quote.transferAmounts).find((t) => t.method === Blockchain.BINANCE_PAY);
    if (!transferAmount?.assets.length) throw new NotFoundException('Transfer amount not found');

    const transferInfo: TransferInfo = {
      asset: transferAmount.assets[0].asset,
      amount: transferAmount.assets[0].amount,
      method: Blockchain.BINANCE_PAY,
      quoteUniqueId: quote.uniqueId,
      referId,
    };

    await this.createActivationRequest(payment.uniqueId, transferInfo);
  }

  async createPayment(paymentLink: PaymentLink, dto: CreatePaymentLinkPaymentDto): Promise<PaymentLinkPayment> {
    if (paymentLink.status !== PaymentLinkStatus.ACTIVE) throw new BadRequestException('Payment link is not active');

    const pendingPayment = paymentLink.payments.some((p) => p.status === PaymentLinkPaymentStatus.PENDING);
    if (pendingPayment)
      throw new ConflictException('There is already a pending payment for the specified payment link');

    if (paymentLink.mode === PaymentLinkMode.SINGLE) {
      const hasPreviousPayment = await this.paymentLinkPaymentRepo.existsBy({
        link: { uniqueId: paymentLink.uniqueId },
      });
      if (hasPreviousPayment) throw new ConflictException('Single payment link can only have one payment');
    }

    if (dto.externalId) {
      const exists = await this.paymentLinkPaymentRepo.existsBy({
        externalId: dto.externalId,
        link: { id: paymentLink.id },
      });
      if (exists) throw new ConflictException('Payment already exists');
    }

    if (isSellRoute(paymentLink.route) && dto.currency && dto.currency !== paymentLink.route.fiat.name)
      throw new BadRequestException('Payment currency mismatch');

    const currency = isSellRoute(paymentLink.route)
      ? paymentLink.route.fiat
      : await this.fiatService.getFiatByName(dto.currency ?? 'CHF');

    const payment = this.paymentLinkPaymentRepo.create({
      amount: dto.amount,
      externalId: dto.externalId,
      note: dto.note,
      expiryDate: dto.expiryDate ?? Util.secondsAfter(paymentLink.configObj.paymentTimeout),
      mode: dto.mode ?? PaymentLinkPaymentMode.SINGLE,
      currency,
      uniqueId: Util.createUniqueId(Config.prefixes.paymentLinkPaymentUidPrefix),
      status: PaymentLinkPaymentStatus.PENDING,
      link: paymentLink,
    });

    const savedPayment = await this.doSave(payment, false);

    // auto confirm (DEV only)
    if (Config.environment !== Environment.PRD && paymentLink.configObj.autoConfirmSecs != null) {
      setTimeout(async () => {
        if (payment.amount === 0.01) {
          payment.cancel();
        } else {
          payment.complete();
        }
        await this.doSave(payment, true);
      }, paymentLink.configObj.autoConfirmSecs * 1000);
    }

    // expiry timers
    //
    // These stay in the process that served the request, although processExpiredPayments is a
    // worker job. Both therefore race for the same payment, and neither the lock nor the lease
    // spans them; what settles it is that the transition itself is atomic, see
    // takePendingTransition. What the timers buy is what they bought before — a caller waiting on
    // this process is released at the timeout rather than at the next tick of a job elsewhere.
    const scanTimeout = paymentLink.configObj.scanTimeout;
    if (scanTimeout) {
      setTimeout(() => this.expirePaymentIfPending(payment.id, true), scanTimeout * 1000);
    }

    const paymentExpiry = Util.secondsAfter(Config.payment.timeoutDelay, payment.expiryDate);
    if (Util.minutesDiff(new Date(), paymentExpiry) <= 60) {
      const paymentTimeout = paymentExpiry.getTime() - new Date().getTime();
      setTimeout(() => this.expirePaymentIfPending(payment.id, false), paymentTimeout);
    }

    return savedPayment;
  }

  private async expirePaymentIfPending(id: number, ignoreWithQuote: boolean): Promise<void> {
    const pendingPayment = await this.paymentLinkPaymentRepo.findOne({
      where: {
        id,
        status: PaymentLinkPaymentStatus.PENDING,
        quotes: { id: ignoreWithQuote ? IsNull() : undefined },
      },
      relations: { link: true },
    });

    if (pendingPayment) await this.expirePayment(pendingPayment);
  }

  async confirmPayment(payment: PaymentLinkPayment): Promise<void> {
    if (payment.status !== PaymentLinkPaymentStatus.COMPLETED)
      throw new BadRequestException('Payment is not completed');

    await this.paymentLinkPaymentRepo.update(payment.id, { isConfirmed: true });
  }

  async cancelByLink(paymentLink: PaymentLink): Promise<PaymentLink> {
    const pendingPayment = paymentLink.payments.find((p) => p.status === PaymentLinkPaymentStatus.PENDING);
    if (!pendingPayment) throw new NotFoundException('No pending payment found');

    pendingPayment.link = paymentLink;

    await this.cancelByPayment(pendingPayment);

    return paymentLink;
  }

  async cancelByPayment(payment: PaymentLinkPayment): Promise<void> {
    // Both callers reach here from a payment they read as `Pending`, and the worker can expire
    // that same payment in between. Whoever the transition lets through sends the webhook.
    const taken = await this.takePendingTransition(payment, PaymentLinkPaymentStatus.CANCELLED, (manager) =>
      this.cancelQuotesForPayment(payment.id, manager),
    );
    if (!taken) return;

    await this.doSave(payment.cancel(), true);
  }

  async deletePayment(payment: PaymentLinkPayment): Promise<void> {
    if (payment.status === PaymentLinkPaymentStatus.COMPLETED)
      throw new BadRequestException('PaymentLinkPayment is already completed, cannot be deleted');

    for (const quote of payment.quotes) {
      await this.paymentQuoteService.deleteQuote(quote);
    }

    for (const activation of payment.activations) {
      await this.paymentActivationService.deleteActivation(activation);
    }

    await this.paymentLinkPaymentRepo.delete(payment.id);
  }

  /** The database effects of leaving `Pending`, run on the manager of the transition's transaction. */
  private async cancelQuotesForPayment(paymentId: number, manager: EntityManager): Promise<void> {
    await this.paymentQuoteService.cancelAllForPayment(paymentId, manager);
    await this.paymentActivationService.closeAllForPayment(paymentId, manager);
  }

  // --- HANDLE CALLBACKS --- //
  async createActivationRequest(
    uniqueId: string,
    transferInfo: TransferInfo,
  ): Promise<LnurlpInvoiceDto | PaymentLinkEvmPaymentDto> {
    const pendingPayment = await this.getPendingPaymentByUniqueId(uniqueId);
    if (!pendingPayment) throw new NotFoundException(`Pending payment not found by id ${uniqueId}`);

    const activation = await this.paymentActivationService.doCreateRequest(pendingPayment, transferInfo);
    return PaymentRequestMapper.toPaymentRequest(activation);
  }

  async handleHexPayment(uniqueId: string, transferInfo: TransferInfo): Promise<PaymentLinkHexResultDto> {
    const pendingPayment = await this.getPendingPaymentByUniqueId(uniqueId);
    if (!pendingPayment) throw new NotFoundException(`Pending payment not found by id ${uniqueId}`);

    const quote = await this.paymentQuoteService.executeHexPayment(transferInfo);
    await this.handleQuoteChange(pendingPayment, quote);

    if (quote.status === PaymentQuoteStatus.TX_FAILED)
      throw new BadRequestException(`Failed to handle hex payment ${uniqueId}: ${quote.errorMessage}`);

    return { txId: quote.txId };
  }

  // --- HANDLE INPUTS --- //
  async getPaymentQuoteByFailedCryptoInput(cryptoInput: CryptoInput): Promise<PaymentQuote | null> {
    const quote = await this.paymentQuoteService.getQuoteByTxId(cryptoInput.address.blockchain, cryptoInput.inTxId, [
      PaymentQuoteStatus.TX_MEMPOOL,
      PaymentQuoteStatus.TX_BLOCKCHAIN,
      PaymentQuoteStatus.TX_COMPLETED,
    ]);
    if (!quote) return null;

    if (quote.status === PaymentQuoteStatus.TX_MEMPOOL) {
      await this.handleBlockchainConfirmed(quote, cryptoInput);
    }

    return quote;
  }

  async getPaymentQuoteByCryptoInput(cryptoInput: CryptoInput): Promise<PaymentQuote | undefined> {
    const quote = await this.getQuoteForInput(cryptoInput);
    if (!quote) throw new Error(`No matching quote found`);

    await this.handleBlockchainConfirmed(quote, cryptoInput);

    return quote;
  }

  private async handleBlockchainConfirmed(quote: PaymentQuote, cryptoInput: CryptoInput): Promise<void> {
    await this.paymentQuoteService.saveBlockchainConfirmed(quote, cryptoInput.address.blockchain, cryptoInput.inTxId);

    const payment = await this.paymentLinkPaymentRepo.findOne({
      where: { id: quote.payment.id },
      relations: { link: { route: { user: { userData: { organization: true } } } } },
    });

    await this.handleQuoteChange(payment, quote);
  }

  private async getQuoteForInput(cryptoInput: CryptoInput): Promise<PaymentQuote | null> {
    const quote = [Blockchain.LIGHTNING, Blockchain.BINANCE_PAY, Blockchain.KUCOIN_PAY].includes(
      cryptoInput.address.blockchain,
    )
      ? await this.getQuoteByActivation(cryptoInput.address.blockchain, cryptoInput.inTxId)
      : await this.getQuoteByTx(cryptoInput.address.blockchain, cryptoInput.inTxId);

    if (quote) return quote;

    return this.paymentQuoteService.getQuoteByAsset(cryptoInput.asset, cryptoInput.amount);
  }

  private async getQuoteByActivation(txBlockchain: Blockchain, txId: string): Promise<PaymentQuote | null> {
    const activation = await this.paymentActivationService.getActivationByTxId(txId);
    if (!activation) return null;

    const quote = activation.quote;
    if (quote && !quote.txId) await this.paymentQuoteService.saveTransaction(quote, txBlockchain, txId);

    return quote;
  }

  private async getQuoteByTx(txBlockchain: Blockchain, txId: string): Promise<PaymentQuote | null> {
    return this.paymentQuoteService.getQuoteByTxId(txBlockchain, txId, [
      PaymentQuoteStatus.TX_RECEIVED,
      PaymentQuoteStatus.TX_MEMPOOL,
      PaymentQuoteStatus.TX_BLOCKCHAIN,
    ]);
  }

  private async handleQuoteChange(payment: PaymentLinkPayment, quote: PaymentQuote): Promise<void> {
    // close activations
    if (PaymentQuoteFinalStates.includes(quote.status))
      if (payment.mode === PaymentLinkPaymentMode.SINGLE) {
        await this.paymentActivationService.closeAllForPayment(payment.id);
      } else {
        await this.paymentActivationService.closeAllForQuote(quote.id);
      }

    if (payment.status !== PaymentLinkPaymentStatus.PENDING) return;

    // update payment status
    const { minCompletionStatus } = payment.link.configObj;

    const isPaymentComplete =
      PaymentQuoteTxStates.indexOf(quote.status) >= PaymentQuoteTxStates.indexOf(minCompletionStatus);
    if (isPaymentComplete) {
      const txCount = await this.paymentQuoteService.getCompletedQuoteCount(payment, minCompletionStatus);
      payment.txCount = txCount;

      // The status read above is the same read-then-write as in expirePayment, and this one is
      // reached from request paths as well as from checkTxConfirmations. A `MULTIPLE` payment
      // stays `Pending` and has no transition to take: it only counts a quote.
      if (payment.mode === PaymentLinkPaymentMode.SINGLE) {
        const taken = await this.takePendingTransition(
          payment,
          PaymentLinkPaymentStatus.COMPLETED,
          // The count belongs to the transition: `doSave` below is the only other thing that
          // writes it, and no job looks at a completed payment again, so a count left behind by a
          // caller that stopped between the two would stay wrong.
          async (manager) => {
            await manager.update(PaymentLinkPayment, payment.id, { txCount });
          },
        );
        if (!taken) return;

        payment.complete();
      }

      await this.doSave(payment, true);
    }
  }

  private async doSave(payment: PaymentLinkPayment, isPaymentDone: boolean): Promise<PaymentLinkPayment> {
    const savedPayment = await this.paymentLinkPaymentRepo.save(payment);

    if (savedPayment.link.webhookUrl) await this.sendWebhook(savedPayment);

    // Delivers to this process directly, which is the whole latency budget when the writing job
    // and the waiting caller share a process. Whoever waits elsewhere is served by
    // deliverPaymentUpdates, which reads the row this save just wrote.
    if (isPaymentDone) {
      this.resolveWaiters(savedPayment);
      this.deliverToDevice(savedPayment);
    }

    return savedPayment;
  }

  private async sendWebhook(payment: PaymentLinkPayment): Promise<void> {
    const paymentForWebhook = await this.paymentLinkPaymentRepo.findOne({
      where: { uniqueId: payment.uniqueId },
      relations: {
        link: { route: { user: { userData: { organization: true } } } },
      },
    });

    const paymentLink = paymentForWebhook.link;
    paymentLink.payments = [paymentForWebhook];

    await this.paymentWebhookService.sendWebhook(paymentLink);
  }
}
