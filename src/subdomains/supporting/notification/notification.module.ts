import { MailerModule } from '@nestjs-modules/mailer';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GetConfig } from 'src/config/config';
import { LoggerModule } from 'src/logger/logger.module';
import { SharedModule } from 'src/shared/shared.module';
import { Notification } from './entities/notification.entity';
import { MailFactory } from './factories/mail.factory';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './repositories/notification.repository';
import { MailService } from './services/mail.service';
import { NotificationJobService } from './services/notification-job.service';
import { NotificationService } from './services/notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    MailerModule.forRoot(GetConfig().mail.options),
    forwardRef(() => SharedModule),
    forwardRef(() => LoggerModule),
  ],
  providers: [NotificationRepository, MailService, NotificationService, MailFactory, NotificationJobService],
  controllers: [NotificationController],
  exports: [NotificationService, MailFactory],
})
export class NotificationModule {}
