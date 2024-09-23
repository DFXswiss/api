import { Config } from 'src/config/config';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { KycLevel, KycType, UserData, UserDataStatus } from '../../user/models/user-data/user-data.entity';
import { IdentCheckError, IdentCheckErrorMap } from '../dto/ident-check-error.enum';
import { IdentResultDto } from '../dto/input/ident-result.dto';
import { KycResultData, KycResultType } from '../dto/kyc-result-data.dto';
import { SumsubResult } from '../dto/sum-sub.dto';
import { KycStepName, KycStepStatus, KycStepType, UrlType } from '../enums/kyc.enum';
import { IdentService } from '../services/integration/ident.service';
import { SumsubService } from '../services/integration/sum-sub.service';
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

      case KycStepName.LEGAL_ENTITY:
        return { url: `${apiUrl}/data/legal/${this.id}`, type: UrlType.API };

      case KycStepName.STOCK_REGISTER:
        return { url: `${apiUrl}/data/stock/${this.id}`, type: UrlType.API };

      case KycStepName.NATIONALITY_DATA:
        return { url: `${apiUrl}/data/nationality/${this.id}`, type: UrlType.API };

      case KycStepName.COMMERCIAL_REGISTER:
        return { url: `${apiUrl}/data/commercial/${this.id}`, type: UrlType.API };

      case KycStepName.SIGNATORY_POWER:
        return { url: `${apiUrl}/data/signatory/${this.id}`, type: UrlType.API };

      case KycStepName.AUTHORITY:
        return { url: `${apiUrl}/data/authority/${this.id}`, type: UrlType.API };

      case KycStepName.IDENT: {
        const service = this.isSumsub ? SumsubService : IdentService;
        return { url: service.identUrl(this), type: UrlType.BROWSER };
      }

      case KycStepName.FINANCIAL_DATA:
        return { url: `${apiUrl}/data/financial/${this.id}`, type: UrlType.API };

      case KycStepName.DFX_APPROVAL:
        return { url: '', type: UrlType.NONE };
    }
  }

  // --- FACTORY --- //
  static create(userData: UserData, name: KycStepName, sequenceNumber: number, type?: KycStepType): KycStep {
    if ([KycStepName.IDENT].includes(name) && type == null) throw new Error('Step type is missing');

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
    return [
      KycStepStatus.FINISHED,
      KycStepStatus.EXTERNAL_REVIEW,
      KycStepStatus.INTERNAL_REVIEW,
      KycStepStatus.MANUAL_REVIEW,
    ].includes(this.status);
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

  externalReview(result?: KycStepResult): this {
    this.status = KycStepStatus.EXTERNAL_REVIEW;

    return this.setResult(result);
  }

  internalReview(result?: KycStepResult): this {
    this.status = KycStepStatus.INTERNAL_REVIEW;

    return this.setResult(result);
  }

  manualReview(): this {
    this.status = KycStepStatus.MANUAL_REVIEW;

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

  get resultData(): KycResultData {
    const result = this.isSumsub ? this.getResult<SumsubResult>() : this.getResult<IdentResultDto>();

    if (result instanceof SumsubResult) {
      return {
        type: KycResultType.SUMSUB,
        firstname: result.data.info?.idDocs?.[0]?.firstName,
        lastname: result.data.info?.idDocs?.[0]?.lastName,
        birthname: null,
        birthday: result.data.info?.idDocs?.[0]?.dob,
        nationality: result.data.info?.idDocs?.[0]?.country,
        identificationDocNumber: result.data.info?.idDocs?.[0]?.number,
        identificationDocType: result.data.info?.idDocs?.[0]?.idDocType,
        identificationType: result.webhook.type,
        result: result.webhook.reviewResult.reviewAnswer,
      };
    }

    return {
      type: KycResultType.ID_NOW,
      firstname: result.userdata?.firstname?.value,
      lastname: result.userdata?.lastname?.value,
      birthname: result.userdata?.birthname?.value,
      birthday: result.userdata?.birthday?.value ? new Date(result.userdata.birthday.value) : null,
      nationality: result.userdata?.nationality?.value,
      identificationDocType: result.identificationdocument?.type?.value,
      identificationDocNumber: result.identificationdocument?.number?.value,
      identificationType: result.identificationprocess?.companyid,
      result: result.identificationprocess?.result,
    };
  }

  get isValidCreatingBankData(): boolean {
    return (
      this.name === KycStepName.IDENT &&
      this.isCompleted &&
      this.userData.status !== UserDataStatus.MERGED &&
      this.userData.kycLevel >= KycLevel.LEVEL_30 &&
      this.identDocumentId &&
      this.userName &&
      this.userData.kycType === KycType.DFX
    );
  }

  get identDocumentId(): string | undefined {
    const result = this.getResult<IdentResultDto>();
    return result?.identificationdocument?.number?.value;
  }

  get userName(): string | undefined {
    const result = this.getResult<IdentResultDto>();
    if (!result) return undefined;
    return [result.userdata?.firstname?.value, result.userdata?.lastname?.value, result.userdata?.birthname?.value]
      .filter((n) => n)
      .map((n) => n.trim())
      .join(' ');
  }

  get identErrorsMailString(): string {
    return `<ul>${this.comment
      .split(';')
      .map((c) => `<li>${IdentCheckErrorMap[c as IdentCheckError]}</li>`)
      .join('')}</ul>`;
  }

  get isSumsub(): boolean {
    return this.type === KycStepType.SUMSUB_AUTO;
  }
}
