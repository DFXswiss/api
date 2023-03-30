import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GetConfig } from 'src/config/config';
import { SharedModule } from 'src/shared/shared.module';
import { MailService } from './services/mail.service';
import { MailFactory } from './factories/mail.factory';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './repositories/notification.repository';
import { NotificationService } from './services/notification.service';
import { Notification } from './entities/notification.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Notification]), MailerModule.forRoot(GetConfig().mail.options), SharedModule],
  providers: [NotificationRepository, MailService, NotificationService, MailFactory],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
