import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';

@Entity('aktionariat_registration')
export class AktionariatRegistration extends IEntity {
  @Index({ unique: true })
  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Index()
  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @Index()
  @ManyToOne(() => KycStep, { nullable: true })
  kycStep?: KycStep;

  @Column({ length: 256 })
  @Index()
  walletAddress: string;

  @Column({ length: 256 })
  status: ReviewStatus;

  @Column({ type: 'text' })
  signature: string;

  @Column({ length: 256 })
  registrationDate: string;

  @Column({ length: 256, nullable: true })
  externalRef?: string;

  @Column({ type: 'text', nullable: true })
  comment?: string;

  @Column({ type: 'text', nullable: true })
  result?: string;

  // --- GETTERS --- //

  get isCompleted(): boolean {
    return this.status === ReviewStatus.COMPLETED;
  }

  get isFailed(): boolean {
    return this.status === ReviewStatus.FAILED;
  }

  get isCanceled(): boolean {
    return this.status === ReviewStatus.CANCELED;
  }

  getResult<T>(): T | undefined {
    if (!this.result) return undefined;
    try {
      return JSON.parse(this.result);
    } catch {
      return undefined;
    }
  }

  // --- UPDATE METHODS --- //

  complete(): UpdateResult<AktionariatRegistration> {
    const update: Partial<AktionariatRegistration> = { status: ReviewStatus.COMPLETED };
    return [this.id, update];
  }

  manualReview(comment?: string): UpdateResult<AktionariatRegistration> {
    const update: Partial<AktionariatRegistration> = { status: ReviewStatus.MANUAL_REVIEW, comment };
    return [this.id, update];
  }
}
