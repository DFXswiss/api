import { ChildEntity, Column } from 'typeorm';
import { KycLog } from './kyc-log.entity';

@ChildEntity()
export class TotpAuthLog extends KycLog {
  @Column()
  ipAddress: string;
}
