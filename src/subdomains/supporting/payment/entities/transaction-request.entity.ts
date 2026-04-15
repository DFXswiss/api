import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { AmountType, Util } from 'src/shared/utils/util';
import { CustodyOrder } from 'src/subdomains/core/custody/entities/custody-order.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { Column, Entity, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { SupportIssue } from '../../support-issue/entities/support-issue.entity';
import { FeeDto } from '../dto/fee.dto';
import { PaymentMethod } from '../dto/payment-method.enum';
import { QuoteError } from '../dto/transaction-helper/quote-error.enum';
import { Transaction } from './transaction.entity';

export enum TransactionRequestType {
  BUY = 'Buy',
  SELL = 'Sell',
  SWAP = 'Swap',
}

export enum TransactionRequestStatus {
  CREATED = 'Created',
  WAITING_FOR_PAYMENT = 'WaitingForPayment',
  COMPLETED = 'Completed',
}

@Entity()
export class TransactionRequest extends IEntity {
  @Column()
  type: TransactionRequestType;

  @Column({ length: 256, default: TransactionRequestStatus.CREATED })
  status: TransactionRequestStatus;

  @Column({ length: 256, unique: true })
  uid: string;

  @Column({ type: 'integer' })
  routeId: number;

  @Column({ type: 'integer' })
  sourceId: number;

  @Column({ type: 'integer' })
  targetId: number;

  @Column({ type: 'float' })
  amount: number;

  @Column({ type: 'float' })
  estimatedAmount: number;

  @Column()
  sourcePaymentMethod: PaymentMethod;

  @Column()
  targetPaymentMethod: PaymentMethod;

  @Column({ nullable: true })
  externalTransactionId?: string;

  @Column({ type: 'float' })
  exchangeRate: number;

  @Column({ type: 'float' })
  rate: number;

  @Column({ length: 'MAX', nullable: true })
  paymentRequest?: string;

  @Column({ nullable: true })
  paymentLink?: string;

  @Column()
  isValid: boolean;

  @Column({ nullable: true })
  error?: QuoteError;

  @Column({ type: 'float', nullable: true })
  dfxFee?: number;

  @Column({ type: 'float', nullable: true })
  networkFee?: number;

  @Column({ type: 'float', nullable: true })
  totalFee?: number;

  @Column({ type: 'simple-json', nullable: true })
  fees?: FeeDto;

  @Column({ type: 'simple-json', nullable: true })
  priceSteps?: PriceStep[];

  @Column({ default: false })
  exactPrice: boolean;

  // TODO: remove and replace with entity method isComplete
  @Column({ default: false })
  isComplete: boolean;

  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column({ length: 'MAX', nullable: true })
  siftResponse?: string;

  @Column({ length: 'MAX', nullable: true })
  aktionariatResponse?: string;

  @OneToOne(() => Transaction, (transaction) => transaction.request, { nullable: true })
  transaction?: Transaction;

  @OneToMany(() => SupportIssue, (supportIssue) => supportIssue.transactionRequest)
  supportIssues: SupportIssue[];

  @OneToOne(() => CustodyOrder, (custodyOrder) => custodyOrder.transactionRequest, { nullable: true })
  custodyOrder: CustodyOrder;

  // --- ENTITY METHODS --- //

  get userData(): UserData {
    return this.user.userData;
  }

  resetStatus(): UpdateResult<TransactionRequest> {
    const update: Partial<TransactionRequest> = { status: TransactionRequestStatus.CREATED };

    Object.assign(this, update);

    return [this.id, update];
  }

  /**
   * Calculates output using quoted price if quote is still valid.
   */
  calculateQuoteOutput(
    validityMinutes: number,
    inputAmount: number,
    marketPrice: number,
    amountType: AmountType,
  ): { outputAmount: number; priceSteps: PriceStep[]; quoteMarketRatio: number } | null {
    if (!this.rate || !this.exchangeRate || !this.priceSteps?.length) return null;

    const quoteAgeMinutes = Util.minutesDiff(this.created);
    if (quoteAgeMinutes > validityMinutes) return null;

    return {
      outputAmount: Util.roundReadable(inputAmount / this.rate, amountType),
      priceSteps: this.priceSteps,
      quoteMarketRatio: Util.round(this.exchangeRate / marketPrice, 8),
    };
  }
}
