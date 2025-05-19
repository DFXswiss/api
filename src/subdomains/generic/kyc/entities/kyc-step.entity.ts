import { Config } from 'src/config/config';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { KycLevel, KycType, UserData, UserDataStatus } from '../../user/models/user-data/user-data.entity';
import { IdentResultData, IdentType } from '../dto/ident-result-data.dto';
import { IdNowResult } from '../dto/ident-result.dto';
import { ManualIdentResult } from '../dto/manual-ident-result.dto';
import { KycSessionInfoDto } from '../dto/output/kyc-info.dto';
import { IdDocType, ReviewAnswer, SumsubResult } from '../dto/sum-sub.dto';
import { KycStepName } from '../enums/kyc-step-name.enum';
import { KycStepStatus, KycStepType, UrlType } from '../enums/kyc.enum';
import { IdentService } from '../services/integration/ident.service';
import { SumsubService } from '../services/integration/sum-sub.service';
import { KycFile } from './kyc-file.entity';
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
  comment?: string;

  @OneToMany(() => StepLog, (l) => l.kycStep)
  logs: StepLog[];

  @OneToMany(() => KycFile, (f) => f.kycStep)
  files: KycFile[];

  // Mail
  @Column({ type: 'datetime2', nullable: true })
  reminderSentDate?: Date;

  // --- GETTERS --- //
  get sessionInfo(): KycSessionInfoDto {
    const apiUrl = `${Config.url(Config.kycVersion)}/kyc`;

    switch (this.name) {
      case KycStepName.CONTACT_DATA:
        return { url: `${apiUrl}/data/contact/${this.id}`, type: UrlType.API };

      case KycStepName.PERSONAL_DATA:
        return { url: `${apiUrl}/data/personal/${this.id}`, type: UrlType.API };

      case KycStepName.NATIONALITY_DATA:
        return { url: `${apiUrl}/data/nationality/${this.id}`, type: UrlType.API };

      case KycStepName.LEGAL_ENTITY:
        return { url: `${apiUrl}/data/legal/${this.id}`, type: UrlType.API };

      case KycStepName.OWNER_DIRECTORY:
        return { url: `${apiUrl}/data/owner/${this.id}`, type: UrlType.API };

      case KycStepName.COMMERCIAL_REGISTER:
        return { url: `${apiUrl}/data/commercial/${this.id}`, type: UrlType.API };

      case KycStepName.SIGNATORY_POWER:
        return { url: `${apiUrl}/data/signatory/${this.id}`, type: UrlType.API };

      case KycStepName.BENEFICIAL_OWNER:
        return {
          url: `${apiUrl}/data/beneficial/${this.id}`,
          type: UrlType.API,
          additionalInfo: { accountHolder: this.userData.naturalPersonName },
        };

      case KycStepName.OPERATIONAL_ACTIVITY:
        return { url: `${apiUrl}/data/operational/${this.id}`, type: UrlType.API };

      case KycStepName.AUTHORITY:
        return { url: `${apiUrl}/data/authority/${this.id}`, type: UrlType.API };

      case KycStepName.IDENT: {
        if (this.isSumsub) {
          return { url: SumsubService.identUrl(this), type: UrlType.TOKEN };
        } else if (this.isManual) {
          return { url: `${apiUrl}/ident/manual/${this.id}`, type: UrlType.API };
        } else {
          return { url: IdentService.identUrl(this), type: UrlType.BROWSER };
        }
      }

      case KycStepName.FINANCIAL_DATA:
        return { url: `${apiUrl}/data/financial/${this.id}`, type: UrlType.API };

      case KycStepName.DFX_APPROVAL:
        return { url: '', type: UrlType.NONE };

      case KycStepName.ADDITIONAL_DOCUMENTS:
        return { url: `${apiUrl}/data/additional/${this.id}`, type: UrlType.API };

      case KycStepName.RESIDENCE_PERMIT:
        return { url: `${apiUrl}/data/residence/${this.id}`, type: UrlType.API };
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
    return [KycStepStatus.IN_PROGRESS, KycStepStatus.ON_HOLD].includes(this.status);
  }

  get isInReview(): boolean {
    return [
      KycStepStatus.FINISHED,
      KycStepStatus.EXTERNAL_REVIEW,
      KycStepStatus.INTERNAL_REVIEW,
      KycStepStatus.MANUAL_REVIEW,
      KycStepStatus.PARTIALLY_APPROVED,
      KycStepStatus.DATA_REQUESTED,
      KycStepStatus.PAUSED,
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

  update(status: KycStepStatus, result?: KycStepResult, sequenceNumber?: number): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      status,
      result: this.setResult(result),
      sequenceNumber,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  complete(result?: KycStepResult): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      status: KycStepStatus.COMPLETED,
      result: this.setResult(result),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  fail(result?: KycStepResult, comment?: string): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      status: KycStepStatus.FAILED,
      result: this.setResult(result),
      comment,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  pause(result?: KycStepResult): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      status: KycStepStatus.IN_PROGRESS,
      result: this.setResult(result),
      reminderSentDate: null,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  cancel(): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      status: KycStepStatus.CANCELED,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  inProgress(result?: KycStepResult): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      status: KycStepStatus.IN_PROGRESS,
      result: this.setResult(result),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  ignored(comment: string): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      status: KycStepStatus.IGNORED,
      comment,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  finish(): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      status: KycStepStatus.FINISHED,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  externalReview(): UpdateResult<KycStep> {
    const update: Partial<KycStep> = { status: KycStepStatus.EXTERNAL_REVIEW };

    Object.assign(this, update);

    return [this.id, update];
  }

  internalReview(result?: KycStepResult): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      status: KycStepStatus.INTERNAL_REVIEW,
      result: this.setResult(result),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  onHold(): UpdateResult<KycStep> {
    const update: Partial<KycStep> = { status: KycStepStatus.ON_HOLD };

    Object.assign(this, update);

    return [this.id, update];
  }

  manualReview(comment?: string, result?: KycStepResult): UpdateResult<KycStep> {
    const update: Partial<KycStep> = {
      status: KycStepStatus.MANUAL_REVIEW,
      comment,
      result: this.setResult(result),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  getResult<T extends KycStepResult>(): T | undefined {
    if (!this.result) return undefined;
    try {
      return JSON.parse(this.result);
    } catch {}

    return this.result as T;
  }

  setResult(result?: KycStepResult): string {
    if (result !== undefined) this.result = typeof result === 'string' ? result : JSON.stringify(result);

    return this.result;
  }

  get resultData(): IdentResultData {
    if (!this.result) return undefined;

    if (this.isSumsub) {
      const identResultData = this.getResult<SumsubResult>();

      const idDocIndex = Math.max(0, identResultData.data.info?.idDocs?.findIndex((doc) => doc.firstName != null) ?? 0);

      return {
        type: IdentType.SUM_SUB,
        firstname: identResultData.data.info?.idDocs?.[idDocIndex]?.firstName,
        lastname: identResultData.data.info?.idDocs?.[idDocIndex]?.lastName,
        birthname: null,
        birthday: identResultData.data.info?.idDocs?.[idDocIndex]?.dob
          ? new Date(identResultData.data.info.idDocs[idDocIndex].dob)
          : undefined,
        nationality: identResultData.data.info?.idDocs?.[idDocIndex]?.country,
        documentNumber: identResultData.data.info?.idDocs?.[idDocIndex]?.number,
        documentType: identResultData.data.info?.idDocs?.[idDocIndex]?.idDocType
          ? identResultData.data.info.idDocs[idDocIndex].idDocType === IdDocType.ID_CARD
            ? 'IDCARD'
            : 'PASSPORT'
          : undefined,
        kycType: identResultData.webhook.levelName,
        success: identResultData.webhook.reviewResult?.reviewAnswer === ReviewAnswer.GREEN,
      };
    } else if (this.isManual) {
      const identResultData = this.getResult<ManualIdentResult>();

      return {
        type: IdentType.MANUAL,
        firstname: identResultData.firstName,
        lastname: identResultData.lastName,
        birthname: identResultData.birthName,
        birthday: new Date(identResultData.birthday),
        nationality: identResultData.nationality?.symbol,
        documentType: identResultData.documentType,
        documentNumber: identResultData.documentNumber,
        kycType: IdentType.MANUAL,
        success: true,
      };
    } else {
      const identResultData = this.getResult<IdNowResult>();

      return {
        type: IdentType.ID_NOW,
        firstname: identResultData.userdata?.firstname?.value,
        lastname: identResultData.userdata?.lastname?.value,
        birthname: identResultData.userdata?.birthname?.value,
        birthday: identResultData.userdata?.birthday?.value ? new Date(identResultData.userdata.birthday.value) : null,
        nationality: identResultData.userdata?.nationality?.value,
        documentType: identResultData.identificationdocument?.type?.value,
        documentNumber: identResultData.identificationdocument?.number?.value,
        kycType: identResultData.identificationprocess?.companyid,
        success: ['SUCCESS_DATA_CHANGED', 'SUCCESS'].includes(identResultData.identificationprocess?.result),
      };
    }
  }

  get identDocumentId(): string {
    const data = this.resultData;
    return data ? `${this.userData.organizationName?.split(' ')?.join('') ?? ''}${data.documentNumber}` : undefined;
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

  get userName(): string | undefined {
    const result = this.resultData;
    if (!result) return undefined;
    return [result.firstname, result.lastname, result.birthname]
      .filter((n) => n)
      .map((n) => n.trim())
      .join(' ');
  }

  get isSumsub(): boolean {
    return this.type === KycStepType.SUMSUB_AUTO || this.type === KycStepType.SUMSUB_VIDEO;
  }

  get isManual(): boolean {
    return this.type === KycStepType.MANUAL;
  }
}
