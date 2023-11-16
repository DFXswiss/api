import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycStepName, KycStepStatus, KycStepType } from '../enums/kyc.enum';

@Entity()
export class KycStep extends IEntity {
  @ManyToOne(() => UserData, (userData) => userData.kycSteps, { nullable: false })
  userData: UserData;

  @Column()
  name: KycStepName;

  @Column({ nullable: true })
  type?: KycStepType;

  @Column()
  status: KycStepStatus;

  @Column({ type: 'integer' })
  sequenceNumber: number;

  @Column({ nullable: true })
  sessionId?: string;

  // --- FACTORY --- //
  static create(
    userData: UserData,
    name: KycStepName,
    sequenceNumber: number,
    type?: KycStepType,
    sessionId?: string,
  ): KycStep {
    return Object.assign(new KycStep(), {
      userData,
      name,
      type,
      status: KycStepStatus.IN_PROGRESS,
      sequenceNumber,
      sessionId,
    });
  }

  // --- KYC PROCESS --- //
  complete(): this {
    this.status = KycStepStatus.COMPLETED;

    return this;
  }

  fail(): this {
    this.status = KycStepStatus.FAILED;

    return this;
  }
}
