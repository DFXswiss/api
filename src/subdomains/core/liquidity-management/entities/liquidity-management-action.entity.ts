import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { LiquidityManagementSystem } from '../enums';

@Entity()
export class LiquidityManagementAction extends IEntity {
  @Column({ length: 256, nullable: false })
  system: LiquidityManagementSystem;

  @Column({ length: 256, nullable: false })
  command: string;

  @Column({ length: 'MAX', nullable: true })
  params: string;

  @ManyToOne(() => LiquidityManagementAction, { nullable: true })
  @JoinColumn()
  onSuccess: LiquidityManagementAction | null;

  @ManyToOne(() => LiquidityManagementAction, { nullable: true })
  @JoinColumn()
  onFail: LiquidityManagementAction | null;

  //*** FACTORY METHODS ***//

  static create(
    system: LiquidityManagementSystem,
    command: string,
    params: Record<string, unknown>,
    onSuccess: LiquidityManagementAction,
    onFail: LiquidityManagementAction,
  ): LiquidityManagementAction {
    const action = new LiquidityManagementAction();

    action.system = system;
    action.command = command;
    action.params = params ? JSON.stringify(params) : null;
    action.onSuccess = onSuccess;
    action.onFail = onFail;

    return action;
  }
}
