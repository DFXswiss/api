import { Injectable } from '@nestjs/common';
import { RecallDto } from './recall.dto';
import { Recall } from './recall.entity';
import { RecallRepository } from './recall.repository';

@Injectable()
export class RecallService {
  constructor(private readonly repo: RecallRepository) {}

  async create(dto: RecallDto): Promise<Recall> {
    const entity = this.repo.create({
      ...dto,
      bankTx: { id: dto.bankTxId },
      checkoutTx: { id: dto.checkoutTxId },
      user: { id: dto.userId },
    });

    return this.repo.save(entity);
  }
}
