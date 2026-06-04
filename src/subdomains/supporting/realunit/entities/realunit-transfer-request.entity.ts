import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

// --- W2W TRANSFER --- //

export enum RealUnitTransferRequestStatus {
  CREATED = 'Created',
  COMPLETED = 'Completed',
}

/**
 * Server-side persisted intent for a user-initiated RealUnit wallet-to-wallet transfer.
 *
 * The user's EIP-7702 delegation is a blanket delegation (ROOT_AUTHORITY, no caveats): it does NOT
 * cryptographically bind the specific recipient or amount — the backend supplies the ERC20 transfer
 * call at execute time. Therefore the transfer intent (recipient + amount) is persisted at prepare
 * time and reused verbatim at confirm; the confirm endpoint never relays recipient/amount taken from
 * untrusted client input.
 */
@Entity()
export class RealUnitTransferRequest extends IEntity {
  @Column({ length: 256, unique: true })
  uid: string;

  @ManyToOne(() => User, { nullable: false, eager: true })
  @Index()
  user: User;

  @Column({ length: 256 })
  toAddress: string;

  @Column({ type: 'float' })
  amount: number;

  @Column({ length: 256, default: RealUnitTransferRequestStatus.CREATED })
  status: RealUnitTransferRequestStatus;

  @Column({ length: 256, nullable: true })
  txHash?: string;

  // --- ENTITY METHODS --- //

  get isComplete(): boolean {
    return this.status === RealUnitTransferRequestStatus.COMPLETED;
  }

  complete(txHash: string): this {
    this.status = RealUnitTransferRequestStatus.COMPLETED;
    this.txHash = txHash;

    return this;
  }
}
