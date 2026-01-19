import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { UserData } from '../../models/user-data/user-data.entity';
import { User } from '../../models/user/user.entity';
import { Wallet } from '../../models/wallet/wallet.entity';
import { WebhookType } from './dto/webhook.dto';

@Entity()
export class Webhook extends IEntity {
  @Column({ length: 256 })
  type: WebhookType;

  @Column({ length: 'MAX' })
  data: string;

  @Column({ length: 256, nullable: true })
  identifier?: string;

  @Column({ length: 256, nullable: true })
  reason?: string;

  @Column({ type: 'datetime2', nullable: true })
  lastTryDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  nextTryDate?: Date;

  @Column({ length: 'MAX', nullable: true })
  error?: string;

  @Column({ default: false })
  isComplete: boolean;

  // References
  @ManyToOne(() => User, { nullable: true, eager: true })
  user?: User;

  @ManyToOne(() => UserData, { nullable: false, eager: true })
  userData: UserData;

  @ManyToOne(() => Wallet, { nullable: false, eager: true })
  wallet: Wallet;

  sentWebhook(error: string): UpdateResult<Webhook> {
    const update: Partial<Webhook> = {
      lastTryDate: new Date(),
      isComplete: !error,
      error,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
