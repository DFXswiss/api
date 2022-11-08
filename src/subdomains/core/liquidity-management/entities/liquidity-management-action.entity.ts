import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, OneToOne } from 'typeorm';
import { LiquidityManagementSystem } from '../enums';

@Entity()
export class LiquidityManagementAction extends IEntity {
  @Column({ length: 256, nullable: false })
  system: LiquidityManagementSystem;

  @Column({ length: 256, nullable: false })
  command: string;

  @OneToOne(() => LiquidityManagementAction, { nullable: true })
  onSuccess: LiquidityManagementAction | null;

  @OneToOne(() => LiquidityManagementAction, { nullable: true })
  onFail: LiquidityManagementAction | null;
}
