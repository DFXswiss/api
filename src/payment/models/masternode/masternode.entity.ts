import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

@Entity()
export class Masternode extends IEntity {
  @Column({ length: 256, unique: true })
  hash: string;

  @Column({ length: 256 })
  owner: string;

  @Column({ length: 256 })
  operator: string;

  @Column({ length: 256 })
  server: string;

  @Column({ type: 'integer' })
  timelock: number;

  @Column()
  enabled: boolean;

  @Column({ type: 'datetime2', nullable: true })
  resignDate: Date;

  @Column({ length: 256, nullable: true })
  resignHash: string;
}
