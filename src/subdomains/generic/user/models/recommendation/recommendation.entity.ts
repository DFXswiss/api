import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
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

  @ManyToOne(() => UserData, { nullable: false })
  recommender: UserData;

  @ManyToOne(() => UserData, { nullable: true })
  recommended: UserData;

  @Column({ length: 256, unique: true })
  code: string;

  @Column({ length: 256 })
  label: string;

  @Column({ default: false })
  isConfirmed: boolean;

  @Column({ type: 'datetime2' })
  expiration: Date;

  get isUsed(): boolean {
    return !!this.recommended;
  }

  get isExpired(): boolean {
    return this.expiration < new Date();
  }
}
