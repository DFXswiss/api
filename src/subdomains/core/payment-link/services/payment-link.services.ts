import { Injectable, NotFoundException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLinkPaymentStatus, PaymentLinkStatus } from '../dto/payment-link.dto';
import { UpdatePaymentLinkDto } from '../dto/update-payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';
import { PaymentLinkPaymentService } from './payment-link-payment.services';

@Injectable()
export class PaymentLinkService {
  private readonly logger = new DfxLogger(PaymentLinkService);

  constructor(
    private readonly paymentLinkRepo: PaymentLinkRepository,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly sellService: SellService,
  ) {}

  async get(userId: number, id: number): Promise<PaymentLink> {
    return this.paymentLinkRepo.findOne({ where: { id, route: { user: { id: userId } } } });
  }

  async getAll(userId: number): Promise<PaymentLink[]> {
    return this.paymentLinkRepo.find({ where: { route: { user: { id: userId } } } });
  }

  async updatePaymentLink(userId: number, id: number, dto: UpdatePaymentLinkDto): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.findOne({ where: { route: { user: { id: userId } }, id } });
    if (!paymentLink) throw new NotFoundException('Payment link not found');
    await this.paymentLinkRepo.update(paymentLink.id, { status: dto.status });
    paymentLink.status = dto.status;
    return paymentLink;
  }

  async create(userId: number, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const route = await this.sellService.get(userId, dto.route);

    // create hash
    const hash = Util.createHash(new Date().getTime().toString()).toUpperCase();

    const paymentLink = this.paymentLinkRepo.create({
      route,
      externalId: dto.externalId,
      status: PaymentLinkStatus.ACTIVE,
      uniqueId: `pl_${hash.slice(0, 6)}`,
      payments: dto.payment ? [await this.paymentLinkPaymentService.create(dto.payment)] : undefined,
    });
    return this.paymentLinkRepo.save(paymentLink);
  }

  async createPayment(userId: number, id: number, dto: CreatePaymentLinkPaymentDto): Promise<PaymentLinkPayment> {
    const paymentLink = await this.paymentLinkRepo.findOne({ where: { route: { user: { id: userId } }, id } });
    if (!paymentLink) throw new NotFoundException('Payment link not found');
    const paymentLinkPayment = await this.paymentLinkPaymentService.create(dto);
    return this.paymentLinkPaymentService.save(paymentLinkPayment);
  }

  async cancelPaymentLinkPayment(userId: number, id: number): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.findOne({ where: { route: { user: { id: userId } }, id } });
    const paymentLinkPayment = paymentLink.payments.find((p) => p.status == PaymentLinkPaymentStatus.PENDING).cancel();
    await this.paymentLinkPaymentService.save(paymentLinkPayment);
    return paymentLink;
  }
}
