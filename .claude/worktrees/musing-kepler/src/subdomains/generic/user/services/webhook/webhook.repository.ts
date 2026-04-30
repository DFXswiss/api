import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Webhook } from './webhook.entity';

@Injectable()
export class WebhookRepository extends BaseRepository<Webhook> {
  constructor(manager: EntityManager) {
    super(Webhook, manager);
  }
}
