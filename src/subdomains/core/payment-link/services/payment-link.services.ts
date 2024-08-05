import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLinkStatus } from '../dto/payment-link.dto';
import { UpdatePaymentLinkDto } from '../dto/update-payment-link.dto';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';
import { DepositAddressCacheEntry, PaymentActivationService } from './payment-activation.service';
import { PaymentLinkPaymentService } from './payment-link-payment.service';

@Injectable()
export class PaymentLinkService implements OnModuleInit {
  static readonly PREFIX_UNIQUE_ID = 'pl';

  constructor(
    private readonly paymentLinkRepo: PaymentLinkRepository,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentActivationService: PaymentActivationService,
    private readonly sellService: SellService,
  ) {}

  async onModuleInit() {
    const depositAddressCacheEntries = await this.paymentLinkRepo
      .find({
        relations: {
          route: { deposit: true },
        },
      })
      .then((pl) =>
        pl.map<DepositAddressCacheEntry>((pl) => ({
          depositAddress: pl.route.deposit.address,
          linkUniqueId: pl.uniqueId,
        })),
      );

    this.paymentActivationService.addDepositAddresses(depositAddressCacheEntries);
  }

  async getOrThrow(userId: number, linkId?: number, linkExternalId?: string): Promise<PaymentLink> {
    let link: PaymentLink;
    if (linkId) link = await this.paymentLinkRepo.getPaymentLinkById(userId, linkId);
    if (linkExternalId) link = await this.paymentLinkRepo.getPaymentLinkByExternalId(userId, linkExternalId);

    if (!link) throw new NotFoundException('Payment link not found');

    if (!link.payments) link.payments = [];

    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(link.uniqueId);
    if (pendingPayment) link.payments.push(pendingPayment);

    return link;
  }

  async getAll(userId: number): Promise<PaymentLink[]> {
    const allPaymentLinks = await this.paymentLinkRepo.getAllPaymentLinks(userId);

    for (const paymentLink of allPaymentLinks) {
      const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(paymentLink.uniqueId);

      if (pendingPayment) {
        paymentLink.payments = [];
        paymentLink.payments.push(pendingPayment);
      }
    }

    return allPaymentLinks;
  }

  async create(userId: number, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const route = dto.routeId
      ? await this.sellService.get(userId, dto.routeId)
      : await this.sellService.getLatest(userId);

    if (!route) throw new NotFoundException('Route not found');
    if (route.deposit.blockchains !== Blockchain.LIGHTNING)
      throw new BadRequestException('Only Lightning routes are allowed');

    if (dto.externalId) {
      const exists = await this.paymentLinkRepo.existsBy({
        externalId: dto.externalId,
        route: { user: { id: userId } },
      });
      if (exists) throw new ConflictException('Payment link already exists');
    }

    const paymentLink = this.paymentLinkRepo.create({
      route,
      externalId: dto.externalId,
      status: PaymentLinkStatus.ACTIVE,
      uniqueId: Util.createUniqueId(PaymentLinkService.PREFIX_UNIQUE_ID),
      payments: [],
    });

    await this.paymentLinkRepo.save(paymentLink);

    this.paymentActivationService.addDepositAddress({
      depositAddress: paymentLink.route.deposit.address,
      linkUniqueId: paymentLink.uniqueId,
    });

    dto.payment &&
      paymentLink.payments.push(await this.paymentLinkPaymentService.createPayment(paymentLink, dto.payment));

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

    paymentLink.payments.push(await this.paymentLinkPaymentService.createPayment(paymentLink, dto));

    return paymentLink;
  }

  async cancelPayment(userId: number, linkId?: number, linkExternalId?: string): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, linkExternalId);

    return this.paymentLinkPaymentService.cancelPayment(paymentLink);
  }
}
