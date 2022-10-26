import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { MailType } from 'src/notification/enums';
import { NotificationService } from 'src/notification/services/notification.service';
import { Lock } from 'src/shared/lock';
import { IsNull, Not } from 'typeorm';
import { LimitRequestDecision } from './limit-request.entity';
import { LimitRequestRepository } from './limit-request.repository';

@Injectable()
export class LimitRequestNotificationService {
  private readonly lock = new Lock(1800);

  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly notificationService: NotificationService,
  ) {}

  @Interval(60000)
  async sendNotificationMails(): Promise<void> {
    if (!this.lock.acquire()) return;

    await this.limitRequestAcceptedManual();

    this.lock.release();
  }

  private async limitRequestAcceptedManual(): Promise<void> {
    const entities = await this.limitRequestRepo.find({
      where: {
        mailSendDate: IsNull(),
        decision: LimitRequestDecision.ACCEPTED,
        clerk: Not(IsNull()),
        edited: Not(IsNull()),
      },
      relations: ['userData'],
    });

    entities.length > 0 && console.log(`Sending ${entities.length} 'limit-request initiated' email(s)`);

    for (const entity of entities) {
      try {
        if (entity.userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.PERSONAL,
            input: {
              userData: entity.userData,
              translationKey: 'mail.limitRequest.manualApproved',
              translationParams: {
                firstname: entity.userData.firstname,
                limitAmount: entity.limit,
              },
              from: Config.support.limitRequest.mailAddress,
              displayName: Config.support.limitRequest.mailName,
              banner: Config.support.limitRequest.mailBanner,
            },
          });
        } else {
          console.error(`Failed to send buy fiat mails ${entity.id}: user has no email`);
        }

        await this.limitRequestRepo.update(...entity.limitRequestMailSendDate());
      } catch (e) {
        console.error(e);
      }
    }
  }
}
