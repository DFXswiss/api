import { Config } from 'src/config/config';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { IdentResultDto } from '../dto/input/ident-result.dto';
import { KycStepName, KycStepStatus, KycStepType, UrlType } from '../enums/kyc.enum';
import { IdentService } from '../services/integration/ident.service';
import { StepLog } from './step-log.entity';

export type KycStepResult = string | object;

@Entity()
@Index((s: KycStep) => [s.userData, s.name, s.type, s.sequenceNumber], { unique: true })
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

  @Column({ nullable: true })
  transactionId?: string;

  @Column({ length: 'MAX', nullable: true })
  result?: string;

  @Column({ length: 'MAX', nullable: true })
  comment: string;

  @OneToMany(() => StepLog, (l) => l.kycStep)
  logs: StepLog;

  // Mail
  @Column({ type: 'datetime2', nullable: true })
  reminderSentDate: Date;

  // --- GETTERS --- //
  get sessionInfo(): { url: string; type: UrlType } {
    const apiUrl = `${Config.url(Config.kycVersion)}/kyc`;

    switch (this.name) {
      case KycStepName.CONTACT_DATA:
        return { url: `${apiUrl}/data/contact/${this.id}`, type: UrlType.API };

      case KycStepName.PERSONAL_DATA:
        return { url: `${apiUrl}/data/personal/${this.id}`, type: UrlType.API };

      case KycStepName.IDENT:
        return { url: IdentService.identUrl(this), type: UrlType.BROWSER };

      case KycStepName.FINANCIAL_DATA:
        return { url: `${apiUrl}/data/financial/${this.id}`, type: UrlType.API };

      case KycStepName.DOCUMENT_UPLOAD:
        return { url: `${apiUrl}/document/${this.id}`, type: UrlType.API };
    }
  }

  // --- FACTORY --- //
  static create(userData: UserData, name: KycStepName, sequenceNumber: number, type?: KycStepType): KycStep {
    if ([KycStepName.IDENT, KycStepName.DOCUMENT_UPLOAD].includes(name) && type == null)
      throw new Error('Step type is missing');

    return Object.assign(new KycStep(), {
      userData,
      name,
      type,
      status: KycStepStatus.IN_PROGRESS,
      sequenceNumber,
    });
  }

  // --- MAIL --- //

  reminderSent(): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      reminderSentDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  // --- KYC PROCESS --- //

  get isInProgress(): boolean {
    return this.status === KycStepStatus.IN_PROGRESS;
  }

  get isInReview(): boolean {
    return [KycStepStatus.FINISHED, KycStepStatus.CHECK_PENDING, KycStepStatus.IN_REVIEW].includes(this.status);
  }

  get isCompleted(): boolean {
    return this.status === KycStepStatus.COMPLETED;
  }

  get isFailed(): boolean {
    return this.status === KycStepStatus.FAILED;
  }

  get isDone(): boolean {
    return this.isInReview || this.isCompleted;
  }

  update(status: KycStepStatus, result?: KycStepResult): this {
    this.status = status;

    return this.setResult(result);
  }

  complete(result?: KycStepResult): this {
    this.status = KycStepStatus.COMPLETED;

    return this.setResult(result);
  }

  fail(result?: KycStepResult): this {
    this.status = KycStepStatus.FAILED;

    return this.setResult(result);
  }

  pause(result?: KycStepResult): this {
    this.status = KycStepStatus.IN_PROGRESS;
    this.reminderSentDate = null;

    return this.setResult(result);
  }

  cancel(): this {
    this.status = KycStepStatus.CANCELED;

    return this;
  }

  ignored(): this {
    this.status = KycStepStatus.IGNORED;

    return this;
  }

  finish(): this {
    if (this.isInProgress) this.status = KycStepStatus.FINISHED;

    return this;
  }

  check(result?: KycStepResult): this {
    this.status = KycStepStatus.CHECK_PENDING;

    return this.setResult(result);
  }

  review(result?: KycStepResult): this {
    this.status = KycStepStatus.IN_REVIEW;

    return this.setResult(result);
  }

  internalReview(): this {
    this.status = KycStepStatus.INTERNAL_REVIEW;

    return this;
  }

  getResult<T extends KycStepResult>(): T | undefined {
    try {
      return JSON.parse(this.result);
    } catch {}

    return this.result as T;
  }

  setResult(result?: KycStepResult): this {
    if (result !== undefined) this.result = typeof result === 'string' ? result : JSON.stringify(result);

    return this;
  }

  get identDocumentId(): string | undefined {
    const result = this.getResult<IdentResultDto>();
    return result?.identificationdocument.number.value;
  }
}
