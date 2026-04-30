import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { IsNull, Like, MoreThan } from 'typeorm';
import { UserRepository } from './user.repository';

@Injectable()
export class UserJobService {
  constructor(private readonly userRepo: UserRepository) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.USER, timeout: 1800 })
  async fillUser() {
    await this.approveUser();
  }

  private async approveUser(): Promise<void> {
    const entities = await this.userRepo.find({
      where: {
        userData: {
          kycFileId: MoreThan(0),
          kycFiles: { type: FileType.USER_NOTES, name: Like('%blockchainAddressAnalyse%') },
        },
        approved: IsNull(),
      },
      relations: { userData: { kycFiles: true } },
    });

    for (const entity of entities) {
      await this.userRepo.update(entity.id, { approved: true });
    }
  }
}
