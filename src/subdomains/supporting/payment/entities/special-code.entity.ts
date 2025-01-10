import { IEntity } from 'src/shared/models/entity';
import { Integrator } from 'src/subdomains/generic/user/models/integrator/integrator.entity';
import { Column, Entity, JoinColumn, OneToMany, OneToOne } from 'typeorm';
import { Fee } from './fee.entity';

export enum SpecialCodeType {
  FEE = 'Fee',
  INTEGRATOR = 'Integrator',
}

@Entity()
export class SpecialCode extends IEntity {
  @Column({ length: 256, unique: true })
  code: string;

  @Column({ length: 256 })
  type: SpecialCodeType;

  @OneToMany(() => Fee, (fee) => fee.code, { nullable: true })
  fees?: Fee[];

  @OneToOne(() => Integrator, { nullable: true })
  @JoinColumn()
  integrator?: Integrator;
}
