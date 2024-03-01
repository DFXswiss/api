import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

@Entity()
export class MultiAccountIban extends IEntity {
  @Column({ length: 256 })
  name: string;

  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256, nullable: true })
  comment: string;
}
