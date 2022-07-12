import { Column, Entity, ManyToOne } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { PocSaga } from './saga.entity';

@Entity({ name: 'poc_saga_log' })
export class PocSagaLog extends IEntity {
  @Column({ length: 256, nullable: false })
  name: string;

  @Column({ length: 256, nullable: true })
  error: string;

  @Column({ nullable: false })
  success: boolean;

  @Column({ type: 'datetime2', nullable: true })
  timestamp: Date;

  @ManyToOne(() => PocSaga, { eager: true, nullable: false })
  saga: PocSaga;
}
