import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GetConfig } from 'src/config/config';
import { SharedModule } from 'src/shared/shared.module';
import { Mail } from './entities/mail.entity';
import { Notification } from './entities/notification.entity';
import { MailFactory } from './factories/mail.factory';
import { NotificationController } from './notification.controller';
import { MailRepository } from './repositories/mail.repository';
import { NotificationRepository } from './repositories/notification.repository';
import { MailJobService } from './services/mail-job.service';
import { MailService } from './services/mail.service';
import { NotificationService } from './services/notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, Mail]),
    MailerModule.forRoot(GetConfig().mail.options),
    SharedModule,
  ],
  providers: [NotificationRepository, MailService, NotificationService, MailFactory, MailRepository, MailJobService],
  controllers: [NotificationController],
  exports: [NotificationService, MailService],
})
export class NotificationModule {}
