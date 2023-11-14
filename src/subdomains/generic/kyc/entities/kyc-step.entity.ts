import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycStepName, KycStepStatus } from '../enums/kyc.enum';

@Entity()
export class KycStep extends IEntity {
  @ManyToOne(() => UserData, (userData) => userData.kycSteps, { nullable: false })
  userData: UserData;

  @Column()
  name: KycStepName;

  @Column()
  status: KycStepStatus;

  @Column({ nullable: true })
  sessionId?: string;

  // --- FACTORY --- //
  static create(name: KycStepName, userData: UserData, sessionId?: string): KycStep {
    return Object.assign(new KycStep(), {
      name,
      userData,
      status: KycStepStatus.IN_PROGRESS,
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
