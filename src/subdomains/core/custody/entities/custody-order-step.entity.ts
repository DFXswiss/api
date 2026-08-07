import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CustodyOrderStepCommand, CustodyOrderStepContext, CustodyOrderStepStatus } from '../enums/custody';
import { CustodyOrder } from './custody-order.entity';

@Entity()
export class CustodyOrderStep extends IEntity {
  @Index()
  @ManyToOne(() => CustodyOrder, (order) => order.steps, { nullable: false, eager: true })
  order: CustodyOrder;

  @Column({ nullable: false, default: CustodyOrderStepStatus.CREATED })
  status: CustodyOrderStepStatus;

  @Column({ nullable: true })
  correlationId: string;

  @Column({ nullable: false })
  index: number;

  @Column({ nullable: false })
  command: CustodyOrderStepCommand;

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

  /**
   * Terminal, and only for a failure the chain has already decided: a transaction that reverted.
   *
   * Not for a step whose state could not be READ — an RPC timeout says nothing about the
   * transaction, and a step marked failed is never looked at again, so treating an unreadable step
   * as a failed one would abandon a run that may well have succeeded. `CustodyJobService` makes
   * that distinction; see the `TransactionRevertedException` branches there.
   */
  fail(): UpdateResult<CustodyOrderStep> {
    return Util.updateEntity<CustodyOrderStep>(this, {
      status: CustodyOrderStepStatus.FAILED,
    });
  }
}
