import { ChildEntity } from 'typeorm';
import { KycLog } from './kyc-log.entity';

@ChildEntity()
export class MergeLog extends KycLog {}
