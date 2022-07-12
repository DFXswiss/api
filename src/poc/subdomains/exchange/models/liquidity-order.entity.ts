import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

@Entity({ name: 'poc_liquidity_order' })
export class PocLiquidityOrder extends IEntity {
  @Column({ length: 256, nullable: false })
  chain: string;

  @Column({ length: 256, nullable: false })
  purchaseId: string;

  @Column({ length: 256, nullable: false })
  correlationId: string;

  @Column({ length: 256, nullable: false })
  asset: string;

  @Column({ type: 'float', nullable: false })
  amount: number;

  @Column({ nullable: true })
  isComplete: boolean;
}
