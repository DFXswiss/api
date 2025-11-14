import { IEntity } from 'src/shared/models/entity';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';

export enum RecommendationCreator {
  RECOMMENDER = 'Recommender',
  RECOMMENDED = 'Recommended',
}

export enum RecommendationType {
  REF_CODE = 'RefCode',
  MAIL = 'Mail',
  RECOMMENDATION_CODE = 'RecommendationCode',
}

@Entity()
export class Recommendation extends IEntity {
  @Column({ length: 256 })
  type: RecommendationType;

  @Column({ length: 256 })
  creator: RecommendationCreator;

  @Column({ length: 256, unique: true })
  code: string;

  @Column({ length: 256 })
  recommendedAlias: string;

  @Column({ length: 256, nullable: true })
  recommendedMail?: string;

  @Column({ nullable: true })
  isConfirmed: boolean; // true = confirmed, false = denied

  @Column({ type: 'datetime2' })
  expiration: Date;

  @ManyToOne(() => UserData, { nullable: false })
  recommender: UserData;

  @ManyToOne(() => UserData, { nullable: true })
  recommended?: UserData;

  @OneToOne(() => KycStep, { nullable: true })
  @JoinColumn()
  kycStep?: KycStep;

  get isUsed(): boolean {
    return !!this.recommended;
  }

  get isExpired(): boolean {
    return this.expiration < new Date();
  }

  get isValid(): boolean {
    return this.isExpired && !this.isUsed;
  }
}
