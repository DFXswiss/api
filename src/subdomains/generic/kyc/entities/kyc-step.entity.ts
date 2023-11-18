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
        return { url: this.identUrl(), urlType: UrlType.BROWSER };

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

  identUrl(): string {
    return `https://go.${Config.kyc.prefix}online-ident.ch/app/dfxauto/identifications/${this.sessionId}/identification/start`;
  }

  // --- KYC PROCESS --- //

  isCompleted(): boolean {
    return this.status == KycStepStatus.COMPLETED;
  }
  complete(): this {
    this.status = KycStepStatus.COMPLETED;

    return this;
  }

  fail(): this {
    this.status = KycStepStatus.FAILED;

    return this;
  }
}
