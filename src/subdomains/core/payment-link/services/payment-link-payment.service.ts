import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LnurlpInvoiceDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncMap } from 'src/shared/utils/async-map';
import { Util } from 'src/shared/utils/util';
import { CryptoInput, PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { LessThan } from 'typeorm';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { PaymentLinkEvmPaymentDto, TransferInfo } from '../dto/payment-link.dto';
import { PaymentRequestMapper } from '../dto/payment-request.mapper';
import { UpdatePaymentLinkPaymentDto } from '../dto/update-payment-link-payment.dto';
import { PaymentActivation } from '../entities/payment-activation.entity';
import { PaymentDevice, PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import {
  PaymentActivationStatus,
  PaymentLinkPaymentMode,
  PaymentLinkPaymentStatus,
  PaymentLinkStatus,
  PaymentStandard,
} from '../enums';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';
import { PaymentActivationService } from './payment-activation.service';
import { PaymentQuoteService } from './payment-quote.service';
import { PaymentWebhookService } from './payment-webhook.service';

@Injectable()
export class PaymentLinkPaymentService {
  private readonly logger = new DfxLogger(PaymentLinkPaymentService);

  static readonly PREFIX_UNIQUE_ID = 'plp';

  private readonly paymentWaitMap = new AsyncMap<number, PaymentLinkPayment>(this.constructor.name);
  private readonly deviceActivationSubject = new Subject<PaymentDevice>();

  constructor(
    private readonly paymentLinkPaymentRepo: PaymentLinkPaymentRepository,
    private readonly paymentWebhookService: PaymentWebhookService,
    private readonly paymentQuoteService: PaymentQuoteService,
    private readonly paymentActivationService: PaymentActivationService,
    private readonly fiatService: FiatService,
  ) {}

  getDeviceActivationObservable(): Observable<PaymentDevice> {
    return this.deviceActivationSubject.asObservable();
  }

  async updatePayment(id: number, dto: UpdatePaymentLinkPaymentDto): Promise<PaymentLinkPayment> {
    const entity = await this.paymentLinkPaymentRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Payment not found');

    return this.paymentLinkPaymentRepo.save(Object.assign(entity, dto));
  }

  // --- HANDLE PENDING PAYMENTS --- //
  async processPendingPayments(): Promise<void> {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    const pendingPaymentLinkPayments = await this.paymentLinkPaymentRepo.findBy({
      status: PaymentLinkPaymentStatus.PENDING,
      expiryDate: LessThan(maxDate),
    });

    for (const pendingPaymentLinkPayment of pendingPaymentLinkPayments) {
      await this.doSave(pendingPaymentLinkPayment.expire());
    }
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

  async waitForPayment(paymentLink: PaymentLink): Promise<void> {
    const pendingPayment = paymentLink.payments.find((p) => p.status === PaymentLinkPaymentStatus.PENDING);
    if (!pendingPayment) throw new NotFoundException('No pending payment found');

    await this.paymentWaitMap.wait(pendingPayment.id, 0);
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

    const currency = dto.currency ? await this.fiatService.getFiatByName(dto.currency) : paymentLink.route.fiat;
    if (!currency) throw new NotFoundException('Currency not found');

    return this.save(dto, currency, paymentLink);
  }

  async cancelPayment(paymentLink: PaymentLink): Promise<PaymentLink> {
    const pendingPayment = paymentLink.payments.find((p) => p.status === PaymentLinkPaymentStatus.PENDING);
    if (!pendingPayment) throw new NotFoundException('No pending payment found');

    await this.doSave(pendingPayment.cancel());

    await this.paymentQuoteService.cancel(pendingPayment.id);
    await this.paymentActivationService.cancel(pendingPayment.id);

    return paymentLink;
  }

  private async save(
    dto: CreatePaymentLinkPaymentDto,
    currency: Fiat,
    paymentLink: PaymentLink,
  ): Promise<PaymentLinkPayment> {
    const payment = this.paymentLinkPaymentRepo.create({
      amount: dto.amount,
      externalId: dto.externalId,
      expiryDate: dto.expiryDate ?? Util.secondsAfter(Config.payment.timeout),
      mode: dto.mode ?? PaymentLinkPaymentMode.SINGLE,
      currency,
      uniqueId: Util.createUniqueId(PaymentLinkPaymentService.PREFIX_UNIQUE_ID),
      status: PaymentLinkPaymentStatus.PENDING,
      link: paymentLink,
    });

    return this.doSave(payment);
  }

  async createActivationRequest(
    uniqueId: string,
    transferInfo: TransferInfo,
  ): Promise<LnurlpInvoiceDto | PaymentLinkEvmPaymentDto> {
    const pendingPayment = await this.getPendingPaymentByUniqueId(uniqueId);
    if (!pendingPayment) throw new NotFoundException(`Pending payment not found by id ${uniqueId}`);

    const activation = await this.paymentActivationService.doCreateRequest(pendingPayment, transferInfo);
    return PaymentRequestMapper.toPaymentRequest(activation);
  }

  // --- GET BY INPUT --- //
  async getPaymentByCryptoInput(cryptoInput: CryptoInput): Promise<PaymentLinkPayment | undefined> {
    if (cryptoInput.txType !== PayInType.PAYMENT) return;

    const pendingPayment = await this.getPendingPayment(cryptoInput);

    if (!pendingPayment) {
      this.logger.error(
        `CryptoInput ${cryptoInput.inTxId}: No pending payment found by asset ${cryptoInput.asset.id} and amount ${cryptoInput.amount}`,
      );
      return;
    }

    await this.paymentQuoteService.saveBlockchainConfirmed(cryptoInput.address.blockchain, cryptoInput.inTxId);

    const pendingActivationData = this.paymentActivationService.getPendingActivation(
      pendingPayment,
      cryptoInput.asset.blockchain,
      cryptoInput.amount,
    );

    if (!pendingActivationData) return;

    return this.doUpdateStatus(
      pendingActivationData.pendingActivation,
      pendingActivationData.otherPendingActivations,
      pendingPayment,
    );
  }

  private async getPendingPayment(cryptoInput: CryptoInput): Promise<PaymentLinkPayment | null> {
    const pendingPayment =
      cryptoInput.address.blockchain === Blockchain.LIGHTNING
        ? await this.getPaymentFromActivation(cryptoInput.inTxId)
        : await this.getPaymentFromQuote(cryptoInput.inTxId);

    if (pendingPayment) return pendingPayment;

    return this.getPendingPaymentByAsset(cryptoInput.asset, cryptoInput.amount);
  }

  private async getPaymentFromActivation(txId: string): Promise<PaymentLinkPayment | null> {
    const activation = await this.paymentActivationService.getActivationByTxId(txId);
    if (!activation) return null;

    const quote = activation.quote;
    if (quote && !quote.txId) await this.paymentQuoteService.saveTransactionId(quote.id, txId, activation.method);

    return this.getPaymentById(activation.payment.id);
  }

  private async getPaymentFromQuote(txId: string): Promise<PaymentLinkPayment | null> {
    const quote = await this.paymentQuoteService.getQuoteByTxId(txId);
    if (!quote) return null;

    return this.getPaymentById(quote.payment.id);
  }

  private async getPendingPaymentByAsset(asset: Asset, amount: number): Promise<PaymentLinkPayment | null> {
    const pendingPayment = await this.paymentLinkPaymentRepo.findOne({
      where: {
        activations: {
          status: PaymentActivationStatus.PENDING,
          standard: PaymentStandard.PAY_TO_ADDRESS,
          asset: { id: asset.id },
          amount,
        },
        status: PaymentLinkPaymentStatus.PENDING,
      },
    });

    if (!pendingPayment) return null;

    return this.getPaymentById(pendingPayment.id);
  }

  private async getPaymentById(id: number): Promise<PaymentLinkPayment | null> {
    return this.paymentLinkPaymentRepo.findOne({
      where: { id },
      relations: {
        link: true,
        activations: true,
      },
    });
  }

  private async doUpdateStatus(
    activationToBeCompleted: PaymentActivation,
    otherPendingActivations: PaymentActivation[],
    pendingPayment: PaymentLinkPayment,
  ): Promise<PaymentLinkPayment> {
    await this.paymentActivationService.complete(activationToBeCompleted);

    pendingPayment.txCount = await this.doUpdateTxCount(pendingPayment.id);

    if (pendingPayment.mode === PaymentLinkPaymentMode.MULTIPLE) {
      this.paymentWaitMap.resolve(pendingPayment.id, pendingPayment);

      if (pendingPayment.device) this.deviceActivationSubject.next(pendingPayment.device);

      return pendingPayment;
    }

    await this.paymentActivationService.expire(otherPendingActivations);

    return this.doSave(pendingPayment.complete());
  }

  private async doUpdateTxCount(paymentId: number): Promise<number> {
    const numberOfCompletedActivations = await this.paymentActivationService.getNumberOfCompletedActivations(paymentId);
    await this.paymentLinkPaymentRepo.update(paymentId, { txCount: numberOfCompletedActivations });

    return numberOfCompletedActivations;
  }

  private async doSave(payment: PaymentLinkPayment): Promise<PaymentLinkPayment> {
    const savedPayment = await this.paymentLinkPaymentRepo.save(payment);

    await this.sendWebhook(savedPayment);

    if (savedPayment.status !== PaymentLinkPaymentStatus.PENDING) {
      this.paymentWaitMap.resolve(savedPayment.id, savedPayment);
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
