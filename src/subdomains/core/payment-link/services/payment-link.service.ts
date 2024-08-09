import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/utils/util';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreateInvoicePaymentDto } from '../dto/create-invoice-payment.dto';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLinkPaymentMode, PaymentLinkStatus } from '../dto/payment-link.dto';
import { UpdatePaymentLinkDto } from '../dto/update-payment-link.dto';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';
import { PaymentLinkPaymentService } from './payment-link-payment.service';

@Injectable()
export class PaymentLinkService {
  static readonly PREFIX_UNIQUE_ID = 'pl';

  constructor(
    private readonly paymentLinkRepo: PaymentLinkRepository,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly sellService: SellService,
    private readonly fiatService: FiatService,
  ) {}

  async getOrThrow(userId: number, linkId?: number, linkExternalId?: string): Promise<PaymentLink> {
    let link: PaymentLink;
    if (linkId) link = await this.paymentLinkRepo.getPaymentLinkById(userId, linkId);
    if (linkExternalId) link = await this.paymentLinkRepo.getPaymentLinkByExternalId(userId, linkExternalId);

    if (!link) throw new NotFoundException('Payment link not found');

    if (!link.payments) link.payments = [];

    const mostRecentPayment = await this.paymentLinkPaymentService.getMostRecentPayment(link.uniqueId);
    if (mostRecentPayment) link.payments.push(mostRecentPayment);

    return link;
  }

  async getAll(userId: number): Promise<PaymentLink[]> {
    const allPaymentLinks = await this.paymentLinkRepo.getAllPaymentLinks(userId);

    for (const paymentLink of allPaymentLinks) {
      if (!paymentLink.payments) paymentLink.payments = [];

      const mostRecentPayment = await this.paymentLinkPaymentService.getMostRecentPayment(paymentLink.uniqueId);
      if (mostRecentPayment) paymentLink.payments.push(mostRecentPayment);
    }

    return allPaymentLinks;
  }

  async create(userId: number, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const route = dto.routeId
      ? await this.sellService.get(userId, dto.routeId)
      : await this.sellService.getLatest(userId);

    if (dto.externalId) {
      const exists = await this.paymentLinkRepo.existsBy({
        externalId: dto.externalId,
        route: { user: { id: userId } },
      });
      if (exists) throw new ConflictException('Payment link already exists');
    }

    return this.createForRoute(route, dto.externalId, dto.payment);
  }

  async createInvoice(dto: CreateInvoicePaymentDto): Promise<PaymentLink> {
    const route = await this.sellService.getById(+dto.routeId);

    const existingLinks = await this.paymentLinkRepo.find({
      where: {
        externalId: dto.externalId,
        route: { id: +dto.routeId },
      },
      relations: { payments: true },
    });
    if (existingLinks.length) {
      const matchingLink = existingLinks.find(
        (l) => l.payments[0]?.amount === +dto.amount && l.payments[0]?.currency.name === dto.currency,
      );
      if (matchingLink) return matchingLink;

      throw new ConflictException('Payment link already exists');
    }

    const payment: CreatePaymentLinkPaymentDto = {
      mode: PaymentLinkPaymentMode.SINGLE,
      amount: +dto.amount,
      externalId: dto.externalId,
      currency: await this.fiatService.getFiatByName(dto.currency),
      expiryDate: dto.expiryDate,
    };

    return this.createForRoute(route, dto.externalId, payment);
  }

  private async createForRoute(
    route: Sell,
    externalId?: string,
    payment?: CreatePaymentLinkPaymentDto,
  ): Promise<PaymentLink> {
    if (!route) throw new NotFoundException('Route not found');
    if (route.deposit.blockchains !== Blockchain.LIGHTNING)
      throw new BadRequestException('Only Lightning routes are allowed');

    const paymentLink = this.paymentLinkRepo.create({
      route,
      externalId: externalId,
      status: PaymentLinkStatus.ACTIVE,
      uniqueId: Util.createUniqueId(PaymentLinkService.PREFIX_UNIQUE_ID),
      payments: [],
    });

    await this.paymentLinkRepo.save(paymentLink);

    payment && paymentLink.payments.push(await this.paymentLinkPaymentService.createPayment(paymentLink, payment));

    return paymentLink;
  }

  async update(
    userId: number,
    dto: UpdatePaymentLinkDto,
    linkId?: number,
    linkExternalId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, linkExternalId);

    paymentLink.status = dto.status;
    await this.paymentLinkRepo.update(paymentLink.id, { status: paymentLink.status });

    return paymentLink;
  }

  // --- PAYMENTS --- //
  async createPayment(
    userId: number,
    dto: CreatePaymentLinkPaymentDto,
    linkId?: number,
    linkExternalId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, linkExternalId);

    paymentLink.payments = [await this.paymentLinkPaymentService.createPayment(paymentLink, dto)];

    return paymentLink;
  }

  async cancelPayment(userId: number, linkId?: number, linkExternalId?: string): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, linkExternalId);

    return this.paymentLinkPaymentService.cancelPayment(paymentLink);
  }
}
