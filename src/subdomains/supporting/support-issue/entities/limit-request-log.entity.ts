import { ChildEntity, Column, Index, ManyToOne } from 'typeorm';
import { LimitRequest, LimitRequestDecision } from './limit-request.entity';
import { SupportLog } from './support-log.entity';

@ChildEntity()
export class LimitRequestLog extends SupportLog {
  @Index()
  @ManyToOne(() => LimitRequest, (s) => s.logs, { onDelete: 'CASCADE' })
  limitRequest: LimitRequest;

  @Column({ length: 256, nullable: true })
  decision?: LimitRequestDecision;
}
