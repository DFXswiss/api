import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GetConfig } from 'src/config/config';
import { MailService } from '../notification/services/mail.service';
import { MailFactory } from './factories/mail.factory';
import { NotificationRepository } from './repositories/notification.repository';
import { NotificationService } from './services/notification.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationRepository]), MailerModule.forRoot(GetConfig().mail.options)],
  providers: [MailService, NotificationService, MailFactory],
  exports: [NotificationService],
})
export class NotificationModule {}
