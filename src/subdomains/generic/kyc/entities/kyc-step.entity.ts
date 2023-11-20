import { Config } from 'src/config/config';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycStepName, KycStepStatus, KycStepType, UrlType } from '../enums/kyc.enum';
import { IdentService } from '../services/integration/ident.service';

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

  @Column({ length: 'MAX', nullable: true })
  result: string;

  // --- GETTERS --- //
  get sessionInfo(): { url: string; urlType: UrlType } {
    const apiUrl = `${Config.url}/kyc`;

    switch (this.name) {
      case KycStepName.CONTACT_DATA:
        return { url: `${apiUrl}/data/contact/${this.id}`, urlType: UrlType.API };

      case KycStepName.PERSONAL_DATA:
        return { url: `${apiUrl}/data/personal/${this.id}`, urlType: UrlType.API };

      case KycStepName.IDENT:
        return { url: IdentService.identUrl(this), urlType: UrlType.BROWSER };

      case KycStepName.FINANCIAL_DATA:
        return { url: `${apiUrl}/data/financial/${this.id}`, urlType: UrlType.API };

      case KycStepName.DOCUMENT_UPLOAD:
        return { url: `${apiUrl}/document/${this.id}`, urlType: UrlType.API };
    }
  }

  // --- FACTORY --- //
  static create(userData: UserData, name: KycStepName, sequenceNumber: number, type?: KycStepType): KycStep {
    if ([KycStepName.IDENT, KycStepName.DOCUMENT_UPLOAD].includes(name) && type == null)
      throw new Error('Missing step type');

    return Object.assign(new KycStep(), {
      userData,
      name,
      type,
      status: KycStepStatus.IN_PROGRESS,
      sequenceNumber,
    });
  }

  // --- KYC PROCESS --- //

  get isInProgress(): boolean {
    return this.status === KycStepStatus.IN_PROGRESS;
  }

  get isInReview(): boolean {
    return this.status === KycStepStatus.IN_REVIEW;
  }

  get isCompleted(): boolean {
    return this.status === KycStepStatus.COMPLETED;
  }

  get isFailed(): boolean {
    return this.status === KycStepStatus.FAILED;
  }

  complete(result?: string): this {
    this.status = KycStepStatus.COMPLETED;
    this.result = result;

    return this;
  }

  fail(result?: string): this {
    this.status = KycStepStatus.FAILED;
    this.result = result;

    return this;
  }

  review(result?: string): this {
    this.status = KycStepStatus.IN_REVIEW;
    this.result = result;

    return this;
  }
}
