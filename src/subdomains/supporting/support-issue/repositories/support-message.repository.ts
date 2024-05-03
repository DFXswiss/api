import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SupportMessage } from '../entities/support-message.entity';

@Injectable()
export class SupportMessageRepository extends BaseRepository<SupportMessage> {
  constructor(manager: EntityManager) {
    super(SupportMessage, manager);
  }
}
