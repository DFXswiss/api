import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { TransferAmount, TransferAmountAsset, TransferMethod } from '../dto/payment-link.dto';
import { PaymentQuoteStatus, PaymentStandard } from '../enums';
import { PaymentActivation } from './payment-activation.entity';
import { PaymentLinkPayment } from './payment-link-payment.entity';

@Entity()
export class PaymentQuote extends IEntity {
  @Column({ length: 256, nullable: false, unique: true })
  uniqueId: string;

  @Column({ length: 256, nullable: false })
  status: PaymentQuoteStatus;

  @ManyToOne(() => PaymentLinkPayment, (p) => p.quotes, { nullable: false })
  payment: PaymentLinkPayment;

  @Column({ length: 'MAX' })
  transferAmounts: string;

  @Column({ type: 'datetime2', nullable: false })
  expiryDate: Date;

  @Column({ length: 256, default: PaymentStandard.OPEN_CRYPTO_PAY })
  standard: PaymentStandard;

  @Column({ length: 256, nullable: true })
  txBlockchain: Blockchain;

  @Column({ length: 'MAX', nullable: true })
  tx: string;

  @Column({ length: 256, nullable: true })
  txId: string;

  @Column({ length: 'MAX', nullable: true })
  errorMessage: string;

  @OneToMany(() => PaymentActivation, (p) => p.quote, { nullable: true })
  activations: PaymentActivation[];

  // --- ENTITY METHODS --- //

  cancel(): this {
    this.status = PaymentQuoteStatus.CANCELLED;

    return this;
  }

  expire(): this {
    this.status = PaymentQuoteStatus.EXPIRED;

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
    const transferAmount = this.getTransferAmountFor(method, asset);
    return transferAmount?.amount === amount;
  }
}
