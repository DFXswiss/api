import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/utils/util';
import { LessThan } from 'typeorm';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkPaymentStatus, PaymentLinkStatus } from '../enums';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';

@Injectable()
export class PaymentLinkPaymentService {
  static readonly PREFIX_UNIQUE_ID = 'plp';

  constructor(
    private readonly paymentLinkPaymentRepo: PaymentLinkPaymentRepository,
    private readonly fiatService: FiatService,
  ) {}

  // --- HANDLE PENDING PAYMENTS --- //
  async processPendingPayments(): Promise<void> {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    const pendingPaymentLinkPayments = await this.paymentLinkPaymentRepo.findBy({
      status: PaymentLinkPaymentStatus.PENDING,
      expiryDate: LessThan(maxDate),
    });

    for (const pendingPaymentLinkPayment of pendingPaymentLinkPayments) {
      await this.paymentLinkPaymentRepo.save(pendingPaymentLinkPayment.expire());
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

  async getPendingPaymentByAsset(asset: Asset, amount: number): Promise<PaymentLinkPayment | null> {
    const pendingPayment = await this.paymentLinkPaymentRepo.findOne({
      where: {
        activations: { asset: { id: asset.id }, amount },
        status: PaymentLinkPaymentStatus.PENDING,
      },
      relations: {
        activations: true,
      },
    });

    if (!pendingPayment) return null;

    return this.paymentLinkPaymentRepo.findOne({
      where: { id: pendingPayment.id },
      relations: {
        link: true,
        activations: true,
      },
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
      relations: {
        link: true,
      },
      order: { updated: 'DESC' },
    });
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

    const currency = await this.fiatService.getFiat(dto.currency.id);
    if (!currency) throw new NotFoundException('Currency not found');

    return this.save(dto, currency, paymentLink);
  }

  async cancelPayment(paymentLink: PaymentLink): Promise<PaymentLink> {
    const pendingPayment = paymentLink.payments.find((p) => p.status === PaymentLinkPaymentStatus.PENDING);
    if (!pendingPayment) throw new NotFoundException('No pending payment found');

    await this.paymentLinkPaymentRepo.save(pendingPayment.cancel());

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
      mode: dto.mode,
      currency,
      uniqueId: Util.createUniqueId(PaymentLinkPaymentService.PREFIX_UNIQUE_ID),
      status: PaymentLinkPaymentStatus.PENDING,
      link: paymentLink,
    });

    return this.paymentLinkPaymentRepo.save(payment);
  }

  async complete(payment: PaymentLinkPayment): Promise<PaymentLinkPayment> {
    return this.paymentLinkPaymentRepo.save(payment.complete());
  }
}
