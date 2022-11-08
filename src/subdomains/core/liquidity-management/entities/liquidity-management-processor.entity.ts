import { IEntity } from 'src/shared/models/entity';
import { Entity } from 'typeorm';
import { LiquidityManagementSystem } from '../enums';

@Entity()
export class LiquidityManagementProcessor extends IEntity {
  system: LiquidityManagementSystem;
}
