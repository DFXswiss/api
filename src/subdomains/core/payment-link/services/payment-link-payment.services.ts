import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { PaymentLinkPaymentStatus, TransferInfo } from '../dto/payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';

@Injectable()
export class PaymentLinkPaymentService {
  private readonly logger = new DfxLogger(PaymentLinkPaymentService);

  constructor(
    private readonly paymentLinkPaymentRepo: PaymentLinkPaymentRepository,
    private readonly assetService: AssetService,
    private readonly pricingService: PricingService,
  ) {}

  async create(paymentLink: PaymentLink, dto: CreatePaymentLinkPaymentDto): Promise<PaymentLinkPayment> {
    const pendingLinkPayment = paymentLink.payments.some((p) => p.status == PaymentLinkPaymentStatus.PENDING);

    if (pendingLinkPayment)
      throw new ConflictException('There is already a pending payment for the specified payment link');

    // create hash
    const hash = Util.createHash(new Date().toString()).toLowerCase();

    const paymentLinkPayment = this.paymentLinkPaymentRepo.create({
      amount: dto.amount,
      externalId: dto.externalId,
      expiryDate: dto.expiryDate ?? Util.secondsAfter(60),
      mode: dto.mode,
      currency: dto.currency,
      uniqueId: `plp_${hash.slice(0, 6)}`,
      transferAmounts: await this.createTransferAmounts(dto.currency, dto.amount).then(JSON.stringify),
      status: PaymentLinkPaymentStatus.PENDING,
      link: paymentLink,
    });

    return this.paymentLinkPaymentRepo.save(paymentLinkPayment);
  }

  async cancel(paymentLinkId: number, userId: number): Promise<void> {
    const paymentLinkPayment = await this.paymentLinkPaymentRepo.findOne({
      where: { link: { id: paymentLinkId, route: { user: { id: userId } } } },
    });
    if (!paymentLinkPayment) throw new NotFoundException('Payment not found');
    paymentLinkPayment.cancel();
    await this.paymentLinkPaymentRepo.save(paymentLinkPayment);
  }

  async createTransferAmounts(currency: Fiat, amount: number): Promise<TransferInfo[]> {
    const paymentAssets = await this.assetService.getPaymentAssets();
    const transferPrices: TransferInfo[] = [];
    for (const asset of paymentAssets) {
      const price = await this.pricingService.getPrice(asset, currency, false);
      transferPrices.push({
        amount: asset.name == 'ZCHF' ? amount : price.invert().convert(amount) / 0.98,
        asset: asset.name,
        method: asset.blockchain,
      });
    }
    return transferPrices;
  }
}
