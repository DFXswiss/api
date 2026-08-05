import { Config } from 'src/config/config';
import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { FileSubType, FileType } from '../dto/kyc-file.dto';
import { KycLog } from './kyc-log.entity';
import { KycStep } from './kyc-step.entity';

@Entity()
// One catalog row per blob: the backfill of the legacy documents checks the catalog before it writes,
// and two overlapping runs would otherwise both pass that check and insert the same blob twice. Partial,
// so it constrains the catalogued blobs only and leaves every canonical row (path null) unaffected.
@Index((f: KycFile) => [f.path], { unique: true, where: '"path" IS NOT NULL' })
export class KycFile extends IEntity {
  @Column({ type: 'text' })
  name: string;

  @Column({ length: 256 })
  type: FileType;

  @Column({ length: 256, nullable: true })
  subType: FileSubType;

  // Full blob key inside the KYC container, set only for rows whose blob lies outside the canonical
  // `user/<userDataId>/<type>/<name>` layout — the legacy Spider-era documents catalogued from
  // `spider/<userDataId>/…`. Null keeps the canonical resolution by category, user, type and name.
  // Sized to the maximum key length the storage accepts, so a key can never be too long to record.
  @Column({ length: 1024, nullable: true })
  path?: string;

  @Column()
  protected: boolean;

  @Column({ default: true })
  valid: boolean;

  @Column({ length: 256, unique: true })
  uid: string;

  @Index()
  @ManyToOne(() => UserData, { nullable: false, eager: true })
  userData: UserData;

  @Index()
  @ManyToOne(() => KycStep, (s) => s.files, { nullable: true })
  kycStep?: KycStep;

  @OneToMany(() => KycLog, (l) => l.file)
  logs?: KycLog[];

  // --- ENTITY METHODS --- //

  get url(): string {
    return `${Config.frontend.services}/file/${this.uid}?show`;
  }
}
