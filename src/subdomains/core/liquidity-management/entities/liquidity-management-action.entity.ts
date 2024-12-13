import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { LiquidityManagementSystem } from '../enums';

@Entity()
export class LiquidityManagementAction extends IEntity {
  @Column({ length: 256 })
  system: LiquidityManagementSystem;

  @Column({ length: 256 })
  command: string;

  @Column({ length: 256, nullable: true })
  tag?: string;

  @Column({ length: 'MAX', nullable: true })
  params?: string;

  @ManyToOne(() => LiquidityManagementAction, { nullable: true })
  @JoinColumn()
  onSuccess?: LiquidityManagementAction | null;

  @ManyToOne(() => LiquidityManagementAction, { nullable: true })
  @JoinColumn()
  onFail?: LiquidityManagementAction | null;

  get paramMap(): Record<string, unknown> | null {
    try {
      return JSON.parse(this.params);
    } catch {
      return null;
    }
  }

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
