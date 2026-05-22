import { Column, Entity, Index } from 'typeorm';
import { IEntity } from '../entity';

@Entity()
@Index(['brand'], { unique: true, where: '"enabled" = true' })
export class CompanyInfo extends IEntity {
  // Brand identifier — `RealUnit`, `DFX`, etc. Lets a single backend serve
  // multiple branded apps from one endpoint.
  @Column({ length: 64 })
  brand: string;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 64, nullable: true })
  phone?: string;

  @Column({ length: 256, nullable: true })
  email?: string;

  @Column({ length: 256, nullable: true })
  website?: string;

  @Column({ length: 256, nullable: true })
  addressStreet?: string;

  @Column({ length: 64, nullable: true })
  addressZip?: string;

  @Column({ length: 256, nullable: true })
  addressCity?: string;

  @Column({ length: 8, nullable: true })
  addressCountry?: string; // ISO 3166-1 alpha-2

  @Column({ default: true })
  enabled: boolean;
}
