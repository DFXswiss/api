import { Column, Entity, OneToMany } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { PocSagaLog } from './saga-log.entity';

@Entity({ name: 'poc_saga' })
export class PocSaga extends IEntity {
  @Column({ length: 256, nullable: false })
  name: string;

  @Column({ length: 256, nullable: false })
  correlationId: string;

  @Column({ length: 256, nullable: true })
  subjectId: string;

  @OneToMany(() => PocSagaLog, (log) => log.saga)
  logs: PocSagaLog[];

  addLog(log: PocSagaLog): this {
    this.logs.push(log);

    return this;
  }
}
