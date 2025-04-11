import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne, TableInheritance } from 'typeorm';
import { KycLogType } from '../enums/kyc.enum';
import { KycFile } from './kyc-file.entity';

@Entity()
@TableInheritance({ column: { type: 'nvarchar', name: 'type' } })
export class KycLog extends IEntity {
  @Column({ length: 256 })
  type: KycLogType;

  @Column({ length: 'MAX', nullable: true })
  result?: string;

  @Column({ length: 256, nullable: true })
  pdfUrl?: string;

  @ManyToOne(() => KycFile, (f) => f.logs, { nullable: true })
  file?: KycFile;

  @Column({ length: 'MAX', nullable: true })
  comment?: string;

  @Column({ type: 'datetime2', nullable: true })
  eventDate?: Date;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  // --- ENTITY METHODS --- //
  setPdfUrl(pdfUrl: string): UpdateResult<KycLog> {
    const update: Partial<KycLog> = {
      pdfUrl,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
