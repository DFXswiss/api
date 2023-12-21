import { ChildEntity, Column } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycLog } from './kyc-log.entity';

@ChildEntity()
export class MergeLog extends KycLog {
  @Column()
  masterUser: UserData;
}
