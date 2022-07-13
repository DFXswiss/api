import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

@Entity({ name: 'poc_payout_order' })
export class PocPayoutOrder extends IEntity {
  @Column({ length: 256, nullable: false })
  chain: string;

  @Column({ length: 256, nullable: false })
  liquidityTransferId: string;

  @Column({ nullable: true })
  isLiquidityTransferComplete: boolean;

  @Column({ length: 256, nullable: true })
  payoutId: string;

  @Column({ length: 256, nullable: false })
  correlationId: string;

  @Column({ length: 256, nullable: false })
  asset: string;

  @Column({ type: 'float', nullable: false })
  amount: number;

  @Column({ length: 256, nullable: false })
  destination: string;

  @Column({ nullable: true })
  isComplete: boolean;
}
