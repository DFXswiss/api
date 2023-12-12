import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne, TableInheritance } from 'typeorm';
import { KycLogType } from '../enums/kyc.enum';

@Entity()
@TableInheritance({ column: { type: 'nvarchar', name: 'type' } })
export class KycLog extends IEntity {
  @Column({ length: 256 })
  type: KycLogType;

  @Column({ length: 'MAX', nullable: true })
  result: string;

  @Column({ length: 256, nullable: true })
  pdfUrl: string;

  @Column({ length: 'MAX', nullable: true })
  comment: string;

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
