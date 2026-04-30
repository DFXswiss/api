import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index } from 'typeorm';

export enum TransactionDirection {
  IN = 'In',
  OUT = 'Out',
}

@Entity()
@Index((ts: TransactionSpecification) => [ts.system, ts.asset, ts.direction], { unique: true })
export class TransactionSpecification extends IEntity {
  @Column({ length: 256 })
  system: string;

  @Column({ length: 256, nullable: true })
  asset?: string;

  @Column({ length: 256, nullable: true })
  direction?: TransactionDirection;

  @Column({ type: 'float' })
  minVolume: number; // CHF

  @Column({ type: 'float' })
  minFee: number; // CHF

  @Column({ nullable: true })
  minConfirmations?: number;

  static default(): TransactionSpecification {
    const spec = new TransactionSpecification();

    spec.minVolume = 0;
    spec.minFee = 0;
    spec.minConfirmations = 0;

    return spec;
  }
}
