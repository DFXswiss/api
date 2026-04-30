import { IEntity } from 'src/shared/models/entity';
import { Entity, Column } from 'typeorm';

@Entity()
export class Ref extends IEntity {
  @Column({ length: 256, unique: true })
  ip: string;

  @Column({ length: 256, nullable: true })
  ref?: string;

  @Column({ length: 256, nullable: true })
  origin?: string;
}
