import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { TransferAmount, TransferAmountAsset, TransferMethod } from '../dto/payment-link.dto';
import { PaymentQuoteStatus, PaymentStandard } from '../enums';
import { PaymentActivation } from './payment-activation.entity';
import { PaymentLinkPayment } from './payment-link-payment.entity';

@Entity()
export class PaymentQuote extends IEntity {
  @Column({ length: 256, unique: true })
  uniqueId: string;

  @Column({ length: 256 })
  status: PaymentQuoteStatus;

  @ManyToOne(() => PaymentLinkPayment, (p) => p.quotes, { nullable: false })
  payment: PaymentLinkPayment;

  @Column({ length: 'MAX' })
  transferAmounts: string;

  @Column({ type: 'datetime2' })
  expiryDate: Date;

  @Column({ length: 256 })
  standard: PaymentStandard;

  @Column({ length: 256, nullable: true })
  txBlockchain?: Blockchain;

  @Column({ length: 'MAX', nullable: true })
  tx?: string;

  @Column({ length: 256, nullable: true })
  txId?: string;

  @Column({ length: 'MAX', nullable: true })
  errorMessage?: string;

  @OneToMany(() => PaymentActivation, (p) => p.quote, { nullable: true })
  activations?: PaymentActivation[];

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.paymentQuote, { nullable: true })
  cryptoInputs?: CryptoInput[];

  // --- ENTITY METHODS --- //

  cancel(): this {
    this.status = PaymentQuoteStatus.CANCELLED;

    return this;
  }

  expire(): this {
    this.status = PaymentQuoteStatus.EXPIRED;

    return this;
  }

  txReceived(blockchain: Blockchain, tx: string): this {
    this.status = PaymentQuoteStatus.TX_RECEIVED;
    this.txBlockchain = blockchain;
    this.tx = tx;

    return this;
  }

  txCheckbot(txId: string): this {
    this.status = PaymentQuoteStatus.TX_CHECKBOT;
    this.txId = txId;

    return this;
  }

  txMempool(txId: string): this {
    this.status = PaymentQuoteStatus.TX_MEMPOOL;
    this.txId = txId;

    return this;
  }

  txFailed(error: string): this {
    this.status = PaymentQuoteStatus.TX_FAILED;
    this.errorMessage = error;

    return this;
  }

  get transferAmountsAsObj(): TransferAmount[] {
    return JSON.parse(this.transferAmounts);
  }

  get transferAmountsForPayRequest(): TransferAmount[] {
    return JSON.parse(this.transferAmounts, this.amountReplacer);
  }

  private amountReplacer(key: any, value: any) {
    if (key === 'amount' && typeof value === 'number') return Util.numberToFixedString(value);

    return value;
  }

  getTransferAmount(method: TransferMethod): TransferAmount | undefined {
    return this.transferAmountsAsObj.find((i) => i.method === method);
  }

  getTransferAmountFor(method: TransferMethod, asset: string): TransferAmountAsset | undefined {
    const transferAmount = this.getTransferAmount(method);
    if (!transferAmount) return;

    return transferAmount.assets.find((a) => a.asset === asset);
  }

  isTransferAmountAsset(method: TransferMethod, asset: string, amount: number): boolean {
    const transferAmount = this.getTransferAmountFor(method, asset);
    return transferAmount?.amount === amount;
  }
}
