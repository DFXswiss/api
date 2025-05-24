import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { WebhookNotifications } from '../entities/webhook-notifications.entity';

@Injectable()
export class WebhookNotificationsRepository extends BaseRepository<WebhookNotifications> {
    constructor(manager: EntityManager) {
        super(WebhookNotifications, manager);
    }
} 