import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

@Entity()
export class SystemState extends IEntity {
  @Column({ type: 'datetime2', nullable: false })
  timestamp: Date;

  @Column({ nullable: false })
  data: string;
}
