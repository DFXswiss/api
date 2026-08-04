import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { EntityManager } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { CreateKycLogDto, UpdateKycLogDto } from '../dto/input/create-kyc-log.dto';
import { FileType } from '../dto/kyc-file.dto';
import { ContentType } from '../enums/content-type.enum';
import { KycFile } from '../entities/kyc-file.entity';
import { KycLog } from '../entities/kyc-log.entity';
import { KycLogType } from '../enums/kyc.enum';
import { KycLogRepository } from '../repositories/kyc-log.repository';
import { KycDocumentService } from './integration/kyc-document.service';

@Injectable()
export class KycLogService {
  constructor(
    private readonly kycLogRepo: KycLogRepository,
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
    private readonly kycDocumentService: KycDocumentService,
  ) {}

  /**
   * Records one address letter dispatch transition, append-only.
   *
   * Written BEFORE the snapshot columns on the account change (`letterClaimDate`, `letterFailures`,
   * `letterSentDate`), so the previous value and the reason for a change stay reconstructible from the
   * database alone. Deliberately not swallowing errors: the caller must fail closed and leave the
   * columns untouched when the trail cannot be written.
   */
  async createAddressLetterLog(
    userData: UserData,
    result: string,
    comment?: string,
    manager?: EntityManager,
    fileId?: number,
  ): Promise<void> {
    const repo = manager?.getRepository(KycLog) ?? this.kycLogRepo;
    const entity = repo.create({
      type: KycLogType.ADDRESS_LETTER,
      eventDate: new Date(),
      result,
      comment,
      userData,
      file: fileId ? ({ id: fileId } as KycFile) : undefined,
    });

    await repo.save(entity);
  }

  async createMergeLog(user: UserData, log: string, manager?: EntityManager): Promise<void> {
    const repo = manager?.getRepository(KycLog) ?? this.kycLogRepo;
    const entity = repo.create({
      type: KycLogType.MERGE,
      result: log,
      userData: user,
    });

    await repo.save(entity);
  }

  async createMergeEffectMarkerLogs(master: UserData, slave: UserData, log: string): Promise<void> {
    await this.kycLogRepo.manager.transaction(async (manager) => {
      await this.createMergeLog(master, log, manager);
      await this.createMergeLog(slave, log, manager);
    });
  }

  async createLog(creatorUserDataId: number, dto: CreateKycLogDto): Promise<void> {
    const entity = this.kycLogRepo.create({
      type: dto.type ?? KycLogType.MANUAL,
      comment: dto.comment,
      eventDate: dto.eventDate,
      result: `Created by user data ${creatorUserDataId}`,
    });

    entity.userData = await this.userDataService.getUserData(dto.userData.id);
    if (!entity.userData) throw new NotFoundException('UserData not found');

    if (dto.file) {
      const { contentType, buffer } = Util.fromBase64(dto.file);

      const { file, url } = await this.kycDocumentService.uploadUserFile(
        entity.userData,
        FileType.USER_NOTES,
        `Manual/${Util.isoDateTime(new Date())}_manual-upload_${Util.randomId()}_${dto.fileName}`,
        buffer,
        contentType as ContentType,
        true,
      );

      entity.pdfUrl = url;
      entity.file = file;
    }

    await this.kycLogRepo.save(entity);
  }

  async createLogInternal(
    userData: UserData,
    type: KycLogType,
    result: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager?.getRepository(KycLog) ?? this.kycLogRepo;
    const entity = repo.create({ type, result, userData: { id: userData.id } });

    await repo.save(entity);
  }

  async updateLog(id: number, dto: UpdateKycLogDto): Promise<void> {
    const entity = await this.kycLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Log not found');
    this.assertMutable(entity);

    await this.kycLogRepo.save(Object.assign({ ...entity, ...dto }));
  }

  async updateLogPdfUrl(id: number, url: string): Promise<void> {
    const entity = await this.kycLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('KycLog not found');
    this.assertMutable(entity);

    await this.kycLogRepo.update(...entity.setPdfUrl(url));
  }

  /**
   * Address letter events are the evidence that a physical letter went out and that the AML proof
   * behind it is honest. They are written append-only inside the transaction that changes the state
   * they describe, so editing one afterwards would make the trail say something the database never
   * did. `PUT /kycAdmin/log/:id` reaches every log by id, hence the guard here rather than there.
   */
  private assertMutable(entity: KycLog): void {
    if (entity.type === KycLogType.ADDRESS_LETTER)
      throw new BadRequestException('Address letter logs are append-only and cannot be changed');
  }

  async createMailChangeLog(user: UserData, oldMail: string, newMail: string) {
    if (oldMail === newMail) return;

    const entity = this.kycLogRepo.create({
      type: KycLogType.MAIL_CHANGE,
      result: `${oldMail} -> ${newMail}`,
      userData: user,
    });

    await this.kycLogRepo.save(entity);
  }

  async getLogsByUserDataId(userDataId: number): Promise<KycLog[]> {
    return this.kycLogRepo.find({
      where: { userData: { id: userDataId } },
      order: { created: 'DESC' },
    });
  }

  async createKycFileLog(log: string, user?: UserData) {
    const entity = this.kycLogRepo.create({
      type: KycLogType.FILE,
      result: log,
      userData: user,
    });

    await this.kycLogRepo.save(entity);
  }
}
