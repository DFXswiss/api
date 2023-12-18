import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';
import { SignatoryState, UserDataRelationState } from './dto/user-data-relation.enum';

@Entity()
export class UserDataRelation extends IEntity {
  @Column({ length: 256, nullable: true })
  relation: UserDataRelationState;

  @Column({ length: 256, nullable: true })
  signatory: SignatoryState;

  // --- REFERENCES --- //
  @ManyToOne(() => UserData, { nullable: false })
  account: UserData;

  @ManyToOne(() => UserData, { nullable: false })
  relatedAccount: UserData;
}
