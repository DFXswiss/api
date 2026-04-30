import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { FileSubType, FileType } from '../dto/kyc-file.dto';
import { KycLog } from './kyc-log.entity';
import { KycStep } from './kyc-step.entity';

@Entity()
export class KycFile extends IEntity {
  @Column({ length: 'MAX' })
  name: string;

  @Column({ length: 256 })
  type: FileType;

  @Column({ length: 256, nullable: true })
  subType: FileSubType;

  @Column()
  protected: boolean;

  @Column({ default: true })
  valid: boolean;

  @Column({ length: 256, unique: true })
  uid: string;

  @ManyToOne(() => UserData, { nullable: false, eager: true })
  userData: UserData;

  @ManyToOne(() => KycStep, (s) => s.files, { nullable: true })
  kycStep?: KycStep;

  @OneToMany(() => KycLog, (l) => l.file)
  logs?: KycLog[];
}
