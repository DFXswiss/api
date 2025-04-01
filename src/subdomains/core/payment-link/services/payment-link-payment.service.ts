import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { Config, Environment } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { LnurlpInvoiceDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { AsyncMap } from 'src/shared/utils/async-map';
import { Util } from 'src/shared/utils/util';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { LessThan } from 'typeorm';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { PaymentLinkEvmPaymentDto, PaymentLinkHexResultDto, TransferInfo } from '../dto/payment-link.dto';
import { PaymentRequestMapper } from '../dto/payment-request.mapper';
import { UpdatePaymentLinkPaymentDto } from '../dto/update-payment-link-payment.dto';
import { PaymentDevice, PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentQuote } from '../entities/payment-quote.entity';
import {
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

@Injectable()
export class PaymentLinkPaymentService {
  static readonly PREFIX_UNIQUE_ID = 'plp';

  private readonly paymentWaitMap = new AsyncMap<number, PaymentLinkPayment>(this.constructor.name);
  private readonly deviceActivationSubject = new Subject<PaymentDevice>();

  constructor(
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
      await this.doSave(payment.expire(), true);

      await this.cancelQuotesForPayment(payment);
    }
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
        link: { route: { deposit: true, user: { userData: true } } },
      },
    });
  }

  async getPaymentByExternalId(externalPaymentId: string): Promise<PaymentLinkPayment | null> {
    return this.paymentLinkPaymentRepo.findOne({
      where: { externalId: externalPaymentId },
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

  async waitForPayment(payment: PaymentLinkPayment): Promise<PaymentLinkPayment> {
    return this.paymentWaitMap.wait(payment.id, 0);
  }

  async createPayment(paymentLink: PaymentLink, dto: CreatePaymentLinkPaymentDto): Promise<PaymentLinkPayment> {
    if (paymentLink.status === PaymentLinkStatus.INACTIVE) throw new BadRequestException('Payment link is inactive');

    const pendingPayment = paymentLink.payments.some((p) => p.status === PaymentLinkPaymentStatus.PENDING);
    if (pendingPayment)
      throw new ConflictException('There is already a pending payment for the specified payment link');

    if (dto.externalId) {
      const exists = await this.paymentLinkPaymentRepo.existsBy({
        externalId: dto.externalId,
        link: { id: paymentLink.id },
      });
      if (exists) throw new ConflictException('Payment already exists');
    }

    if (dto.currency && dto.currency !== paymentLink.route.fiat.name)
      throw new BadRequestException('Payment currency mismatch');

    const payment = this.paymentLinkPaymentRepo.create({
      amount: dto.amount,
      externalId: dto.externalId,
      expiryDate: dto.expiryDate ?? Util.secondsAfter(paymentLink.paymentTimeout),
      mode: dto.mode ?? PaymentLinkPaymentMode.SINGLE,
      currency: paymentLink.route.fiat,
      uniqueId: Util.createUniqueId(PaymentLinkPaymentService.PREFIX_UNIQUE_ID, 16),
      status: PaymentLinkPaymentStatus.PENDING,
      link: paymentLink,
    });

    const savedPayment = await this.doSave(payment, false);

    // auto confirm (DEV only)
    if (Config.environment !== Environment.PRD && paymentLink.configObj.autoConfirmSecs != null) {
      setTimeout(async () => {
        payment.amount === 0.01 ? payment.cancel() : payment.complete();
        await this.doSave(payment, true);
      }, paymentLink.configObj.autoConfirmSecs * 1000);
    }

    return savedPayment;
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
    if (payment.mode !== PaymentLinkPaymentMode.MULTIPLE) await this.doSave(payment.cancel(), true);

    await this.cancelQuotesForPayment(payment);
  }

  private async cancelQuotesForPayment(payment: PaymentLinkPayment): Promise<void> {
    await this.paymentQuoteService.cancelAllForPayment(payment.id);
    await this.paymentActivationService.closeAllForPayment(payment.id);
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

    if (quote.status === PaymentQuoteStatus.TX_FAILED) throw new ServiceUnavailableException(quote.errorMessage);

    return { txId: quote.txId };
  }

  // --- HANDLE INPUTS --- //
  async getPaymentQuoteByCryptoInput(cryptoInput: CryptoInput): Promise<PaymentQuote | undefined> {
    const quote = await this.getQuoteForInput(cryptoInput);
    if (!quote) throw new Error(`No matching quote found`);

    await this.paymentQuoteService.saveBlockchainConfirmed(quote, cryptoInput.address.blockchain, cryptoInput.inTxId);

    const payment = await this.paymentLinkPaymentRepo.findOne({
      where: { id: quote.payment.id },
      relations: { link: { route: { user: { userData: true } } } },
    });

    await this.handleQuoteChange(payment, quote);

    return quote;
  }

  private async getQuoteForInput(cryptoInput: CryptoInput): Promise<PaymentQuote | null> {
    const quote =
      cryptoInput.address.blockchain === Blockchain.LIGHTNING
        ? await this.getLightningQuoteByTx(cryptoInput.address.blockchain, cryptoInput.inTxId)
        : await this.getQuoteByTx(cryptoInput.address.blockchain, cryptoInput.inTxId);

    if (quote) return quote;

    return this.paymentQuoteService.getQuoteByAsset(cryptoInput.asset, cryptoInput.amount);
  }

  private async getLightningQuoteByTx(txBlockchain: Blockchain, txId: string): Promise<PaymentQuote | null> {
    const activation = await this.paymentActivationService.getActivationByTxId(txId);
    if (!activation) return null;

    const quote = activation.quote;
    if (quote && !quote.txId) await this.paymentQuoteService.saveTransaction(quote, txBlockchain, txId);

    return quote;
  }

  private async getQuoteByTx(txBlockchain: Blockchain, txId: string): Promise<PaymentQuote | null> {
    return this.paymentQuoteService.getQuoteByTxId(txBlockchain, txId);
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
      payment.txCount = await this.paymentQuoteService.getCompletedQuoteCount(payment, minCompletionStatus);

      if (payment.mode === PaymentLinkPaymentMode.SINGLE) payment.complete();

      await this.doSave(payment, true);
    }
  }

  private async doSave(payment: PaymentLinkPayment, isPaymentDone: boolean): Promise<PaymentLinkPayment> {
    const savedPayment = await this.paymentLinkPaymentRepo.save(payment);

    if (savedPayment.link.webhookUrl) await this.sendWebhook(savedPayment);

    if (isPaymentDone) {
      this.paymentWaitMap.resolve(savedPayment.id, savedPayment);
      if (payment.device) this.deviceActivationSubject.next(payment.device);
    }

    return savedPayment;
  }

  private async sendWebhook(payment: PaymentLinkPayment): Promise<void> {
    const paymentForWebhook = await this.paymentLinkPaymentRepo.findOne({
      where: { uniqueId: payment.uniqueId },
      relations: {
        link: { route: { user: { userData: true } } },
      },
    });

    const paymentLink = paymentForWebhook.link;
    paymentLink.payments = [paymentForWebhook];

    await this.paymentWebhookService.sendWebhook(paymentLink);
  }
}
