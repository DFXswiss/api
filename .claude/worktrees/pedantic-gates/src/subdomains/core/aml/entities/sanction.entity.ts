import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

@Entity()
export class Sanction extends IEntity {
  @Column()
  currency: string;

  @Column()
  address: string;
}
