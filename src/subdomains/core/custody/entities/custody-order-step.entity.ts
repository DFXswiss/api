import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, ManyToOne } from 'typeorm';
import { CustodyOrderStepContext, CustodyOrderStepStatus } from '../enums/custody';
import { CustodyOrder } from './custody-order.entity';

@Entity()
export class CustodyOrderStep extends IEntity {
  @ManyToOne(() => CustodyOrder, (order) => order.steps, { nullable: false, eager: true })
  order: CustodyOrder;

  @Column({ nullable: false, default: CustodyOrderStepStatus.CREATED })
  status: CustodyOrderStepStatus;

  @Column({ nullable: true })
  correlationId: string;

  @Column({ nullable: false })
  index: number;

  @Column({ nullable: false })
  command: string;

  @Column({ nullable: false })
  context: CustodyOrderStepContext;

  progress(correlationId: string): UpdateResult<CustodyOrderStep> {
    return Util.updateEntity<CustodyOrderStep>(this, {
      status: CustodyOrderStepStatus.IN_PROGRESS,
      correlationId,
    });
  }

  complete(): UpdateResult<CustodyOrderStep> {
    return Util.updateEntity<CustodyOrderStep>(this, {
      status: CustodyOrderStepStatus.COMPLETED,
    });
  }
}
