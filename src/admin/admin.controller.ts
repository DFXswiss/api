import { Controller, Post, UseGuards, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MailService } from 'src/shared/services/mail.service';
import { SendMailDto } from './dto/send-mail.dto';

@Controller('admin')
export class AdminController {
  constructor(readonly mailService: MailService) {}

  @Post('mail')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendMail(@Body() sendMailDtoList: SendMailDto[]): Promise<void> {
    for (const sendMailDto of sendMailDtoList) {
      await this.mailService.sendMail(sendMailDto.mail, sendMailDto.salutation, sendMailDto.subject, sendMailDto.body);
    }
  }
}
