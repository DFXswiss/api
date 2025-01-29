import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { CreateKycLogDto, UpdateKycLogDto } from '../dto/input/create-kyc-log.dto';
import { FileType } from '../dto/kyc-file.dto';
import { ContentType } from '../enums/content-type.enum';
import { KycFileLogRepository } from '../repositories/kyc-file-log.repository';
import { KycLogRepository } from '../repositories/kyc-log.repository';
import { MailChangeLogRepository } from '../repositories/mail-change-log.repository';
import { MergeLogRepository } from '../repositories/merge-log.repository';
import { KycDocumentService } from './integration/kyc-document.service';

@Injectable()
export class KycLogService {
  constructor(
    private readonly kycLogRepo: KycLogRepository,
    private readonly mergeLogRepo: MergeLogRepository,
    private readonly kycFileLogRepo: KycFileLogRepository,
    private readonly mailChangeLogRepo: MailChangeLogRepository,
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
    private readonly kycDocumentService: KycDocumentService,
  ) {}

  async createMergeLog(user: UserData, log: string): Promise<void> {
    const entity = this.mergeLogRepo.create({
      result: log,
      userData: user,
    });

    await this.kycLogRepo.save(entity);
  }

  async createLog(creatorUserDataId: number, dto: CreateKycLogDto): Promise<void> {
    const entity = this.kycLogRepo.create(dto);

    entity.result = `Created by user data ${creatorUserDataId}`;

    entity.userData = await this.userDataService.getUserData(dto.userData.id);
    if (!entity.userData) throw new NotFoundException('UserData not found');

    if (dto.file) {
      const { contentType, buffer } = Util.fromBase64(dto.file);

      entity.pdfUrl = await this.kycDocumentService.uploadUserFile(
        entity.userData,
        FileType.USER_NOTES,
        `Manual/${Util.isoDateTime(dto.eventDate)}_manual-upload_${Util.randomId()}_${dto.fileName}`,
        buffer,
        contentType as ContentType,
        true,
      );
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

    const entity = this.mailChangeLogRepo.create({
      result: `${oldMail} -> ${newMail}`,
      userData: user,
    });

    await this.kycLogRepo.save(entity);
  }

  async createKycFileLog(log: string, user?: UserData) {
    const entity = this.kycFileLogRepo.create({
      result: log,
      userData: user,
    });

    await this.kycLogRepo.save(entity);
  }
}
