import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { OlkyRecipient } from '../entities/olky-recipient.entity';

@Injectable()
export class OlkyRecipientRepository extends BaseRepository<OlkyRecipient> {
  constructor(manager: EntityManager) {
    super(OlkyRecipient, manager);
  }
}
