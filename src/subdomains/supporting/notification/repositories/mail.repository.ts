import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Mail } from '../entities/mail.entity';

@Injectable()
export class MailRepository extends BaseRepository<Mail> {
  constructor(manager: EntityManager) {
    super(Mail, manager);
  }
}
