import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { MailService } from '../notification/services/mail.service';
import { NotificationService } from './services/notification.service';

@Module({
  imports: [MailerModule.forRoot(GetConfig().mail.options)],
  providers: [MailService, NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
