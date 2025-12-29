import { ChildEntity, Column } from 'typeorm';
import { KycLog } from './kyc-log.entity';

@ChildEntity()
export class TfaLog extends KycLog {
  @Column()
  ipAddress: string;
}
