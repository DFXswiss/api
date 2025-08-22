import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { CreateKycLogDto, UpdateKycLogDto } from '../dto/input/create-kyc-log.dto';
import { FileType } from '../dto/kyc-file.dto';
import { ContentType } from '../enums/content-type.enum';
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

  async createMergeLog(user: UserData, log: string): Promise<void> {
    const entity = this.kycLogRepo.create({
      type: KycLogType.MERGE,
      result: log,
      userData: user,
    });

    await this.kycLogRepo.save(entity);
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

  async updateLog(id: number, dto: UpdateKycLogDto): Promise<void> {
    const entity = await this.kycLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Log not found');

    await this.kycLogRepo.save(Object.assign({ ...entity, ...dto }));
  }

  async updateLogPdfUrl(id: number, url: string): Promise<void> {
    const entity = await this.kycLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('KycLog not found');

    await this.kycLogRepo.update(...entity.setPdfUrl(url));
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

  async createKycFileLog(log: string, user?: UserData) {
    const entity = this.kycLogRepo.create({
      type: KycLogType.FILE,
      result: log,
      userData: user,
    });

    await this.kycLogRepo.save(entity);
  }
}
