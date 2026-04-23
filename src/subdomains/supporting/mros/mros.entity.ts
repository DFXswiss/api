import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { MrosStatus } from './mros-status.enum';

@Entity()
export class Mros extends IEntity {
  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @Column({ length: 256 })
  status: MrosStatus;

  @Column({ length: 256, default: 'SAR' })
  reportCode: string;

  @Column({ type: 'datetime2', nullable: true })
  submissionDate?: Date;

  @Column({ length: 256, nullable: true })
  authorityReference?: string;

  @Column({ length: 256 })
  caseManager: string;

  @Column({ length: 'MAX', nullable: true })
  reason?: string;

  @Column({ length: 'MAX', nullable: true })
  action?: string;

  // JSON-serialized string[] of goAML indicator codes (e.g. ["0002M","1004V"])
  @Column({ length: 'MAX', nullable: true })
  indicators?: string;

  get indicatorCodes(): string[] {
    return this.indicators ? JSON.parse(this.indicators) : [];
  }

  set indicatorCodes(codes: string[]) {
    this.indicators = JSON.stringify(codes);
  }
}
