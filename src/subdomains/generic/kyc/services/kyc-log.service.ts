import { Injectable, NotFoundException } from '@nestjs/common';
import { KycLogRepository } from '../repositories/kyc-log.repository';

@Injectable()
export class KycLogService {
  constructor(private readonly kycLogRepo: KycLogRepository) {}

  async updatePdfUrl(id: number, url: string): Promise<void> {
    const entity = await this.kycLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('KycLog not found');

    await this.kycLogRepo.update(...entity.setPdfUrl(url));
  }
}
