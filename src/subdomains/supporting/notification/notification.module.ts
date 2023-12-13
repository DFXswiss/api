import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { Notification } from './entities/notification.entity';
import { MailFactory } from './factories/mail.factory';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './repositories/notification.repository';
import { MailService } from './services/mail.service';
import { NotificationService } from './services/notification.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification]), SharedModule],
  providers: [NotificationRepository, MailService, NotificationService, MailFactory],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
