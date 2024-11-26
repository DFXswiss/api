import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

@Entity()
export class ServiceProvider extends IEntity {
  @Column({ length: 256 })
  name: string;

  @Column({ length: 256, nullable: true })
  mail: string;

  @Column({ length: 256 })
  masterKey: string;
}
