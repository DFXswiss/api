import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { FileType } from '../dto/kyc-file.dto';
import { KycStep } from './kyc-step.entity';

@Entity()
export class KycFile extends IEntity {
  @Column({ length: 'MAX', nullable: false })
  name: string;

  @Column({ length: 256, nullable: false })
  type: FileType;

  @Column({ nullable: false })
  protected: boolean;

  @Column({ length: 256, nullable: false, unique: true })
  uid: string;

  @ManyToOne(() => UserData, { nullable: false, eager: true })
  userData: UserData;

  @ManyToOne(() => KycStep, { nullable: true })
  kycStep: KycStep;
}
