import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

export enum BuyCryptoBatchStatus {
  CREATED = 'created',
  SECURED = 'secured',
  PAUSED = 'paused',
  COMPLETE = 'complete',
}

@Entity()
export class BuyCryptoBatch extends IEntity {
  @Column({ length: 256, nullable: false })
  outputReferenceAsset: string;

  @Column({ length: 256, nullable: false })
  outputAsset: string;

  @Column({ length: 256, nullable: true })
  status: string;

  @Column({ length: 256, nullable: true })
  amount: number;
}
