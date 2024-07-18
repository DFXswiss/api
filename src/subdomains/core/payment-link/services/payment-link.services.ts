import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLinkStatus } from '../dto/payment-link.dto';
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
  ) {}

  async get(userId: number, idOrExternalId: string): Promise<PaymentLink> {
    return this.paymentLinkRepo.getPaymentLink(userId, idOrExternalId);
  }

  async getAll(userId: number): Promise<PaymentLink[]> {
    return this.paymentLinkRepo.find({ where: { route: { user: { id: userId } } }, relations: { route: true } });
  }

  async update(userId: number, idOrExternalId: string, dto: UpdatePaymentLinkDto): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.getPaymentLink(userId, idOrExternalId);
    if (!paymentLink) throw new NotFoundException('Payment link not found');

    paymentLink.status = dto.status;
    await this.paymentLinkRepo.update(paymentLink.id, { status: paymentLink.status });

    return paymentLink;
  }

  async create(userId: number, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const route = dto.routeId
      ? await this.sellService.get(userId, dto.routeId)
      : await this.sellService.getLastest(userId);

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

    dto.payment &&
      paymentLink.payments.push(await this.paymentLinkPaymentService.createPayment(paymentLink, dto.payment));

    return paymentLink;
  }

  // --- PAYMENTS --- //
  async createPayment(userId: number, idOrExternalId: string, dto: CreatePaymentLinkPaymentDto): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.getPaymentLink(userId, idOrExternalId);
    if (!paymentLink) throw new NotFoundException('Payment link not found');

    paymentLink.payments.push(await this.paymentLinkPaymentService.createPayment(paymentLink, dto));

    return paymentLink;
  }

  async cancelPayment(userId: number, linkOrExternalId: string): Promise<PaymentLink> {
    return this.paymentLinkPaymentService.cancelPayment(userId, linkOrExternalId);
  }
}
