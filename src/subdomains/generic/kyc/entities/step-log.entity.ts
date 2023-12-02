import { ChildEntity, Column, ManyToOne } from 'typeorm';
import { KycStepStatus } from '../enums/kyc.enum';
import { KycLog } from './kyc-log.entity';
import { KycStep } from './kyc-step.entity';

@ChildEntity()
export class StepLog extends KycLog {
  @ManyToOne(() => KycStep)
  kycStep: KycStep;

  @Column()
  status: KycStepStatus;
}
