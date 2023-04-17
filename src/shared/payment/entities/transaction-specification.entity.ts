import { Entity, Column } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';

export enum TransactionDirection {
  IN = 'In',
  OUT = 'Out',
}

@Entity()
export class TransactionSpecification extends IEntity {
  @Column({ length: 256, nullable: true })
  system: string;

  @Column({ length: 256, nullable: true })
  asset: string;

  @Column({ type: 'float', nullable: true })
  minVolume: number;

  @Column({ type: 'float', nullable: true })
  minFee: number;

  @Column({ length: 256, nullable: true })
  direction: TransactionDirection;
}
