import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, ManyToOne } from 'typeorm';

export enum PaymentActivationState {
  PENDING = 'pending',
  EXPIRED = 'expired',
  DUPLICATE = 'duplicate',
  FAILED = 'failed',
  COMPLETED = 'completed',
}

export class PaymentActivation extends IEntity {
  @Column()
  state: PaymentActivationState;

  @Column()
  method: Blockchain;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @Column({ type: 'float' })
  amount: number;

  @Column({ type: 'datetime2' })
  expiryDate: Date;

  // 1:n Referenz zu Payment
}
