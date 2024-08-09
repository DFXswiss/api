import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { TransferAmount, TransferAmountAsset, TransferMethod } from '../dto/payment-link.dto';
import { PaymentLinkPaymentQuoteStatus } from '../enums';
import { PaymentLinkPayment } from './payment-link-payment.entity';

@Entity()
export class PaymentLinkPaymentQuote extends IEntity {
  @Column({ length: 256, nullable: false, unique: true })
  uniqueId: string;

  @Column({ length: 256, nullable: false })
  status: PaymentLinkPaymentQuoteStatus;

  @ManyToOne(() => PaymentLinkPayment, (p) => p.quotes, { nullable: false })
  payment: PaymentLinkPayment;

  @Column({ length: 'MAX' })
  transferAmounts: string;

  @Column({ type: 'datetime2', nullable: false })
  expiryDate: Date;

  // --- ENTITY METHODS --- //

  cancel(): this {
    this.status = PaymentLinkPaymentQuoteStatus.CANCELLED;

    return this;
  }

  expire(): this {
    this.status = PaymentLinkPaymentQuoteStatus.EXPIRED;

    return this;
  }

  get transferAmountsAsObj(): TransferAmount[] {
    return JSON.parse(this.transferAmounts);
  }

  getTransferAmountFor(method: TransferMethod, asset: string): TransferAmountAsset | undefined {
    const transferAmount = this.transferAmountsAsObj.find((i) => i.method === method);
    if (!transferAmount) return;

    return transferAmount.assets.find((a) => a.asset === asset);
  }

  isTransferAmountAsset(method: TransferMethod, asset: string, amount: number): boolean {
    const transferAmount = this.transferAmountsAsObj.find((i) => i.method === method);
    if (!transferAmount) return false;

    return transferAmount.assets.find((a) => a.asset === asset && a.amount === amount) !== undefined;
  }
}
