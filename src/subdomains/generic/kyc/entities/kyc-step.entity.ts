import { Config } from 'src/config/config';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycStepName, KycStepStatus, KycStepType, UrlType } from '../enums/kyc.enum';

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

  // --- GETTERS --- //
  get sessionInfo(): { url: string; urlType: UrlType } {
    const apiUrl = `${Config.url}/kyc`;

    switch (this.name) {
      case KycStepName.MAIL:
      case KycStepName.PERSONAL_DATA:
        return { url: `${apiUrl}/data/personal/${this.id}`, urlType: UrlType.API };

      case KycStepName.IDENT:
        return { url: `TODO: get from IntrumService (static method?)`, urlType: UrlType.BROWSER };

      case KycStepName.FINANCIAL_DATA:
        return { url: `${apiUrl}/data/financial/${this.id}`, urlType: UrlType.API };

      case KycStepName.DOCUMENT_UPLOAD:
        return { url: `${apiUrl}/document/${this.id}`, urlType: UrlType.API };
    }
  }

  // --- FACTORY --- //
  static create(
    userData: UserData,
    name: KycStepName,
    sequenceNumber: number,
    type?: KycStepType,
    sessionId?: string,
  ): KycStep {
    if (name === KycStepName.IDENT && sessionId == null) throw new Error('Missing session ID');
    if ([KycStepName.IDENT, KycStepName.DOCUMENT_UPLOAD].includes(name) && type == null)
      throw new Error('Missing step type');

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
