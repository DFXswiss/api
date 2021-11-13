import { Controller, Post, UseGuards, Body, Get } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MailService } from 'src/shared/services/mail.service';
import { UserService } from 'src/user/models/user/user.service';
import { SendMailDto } from './dto/send-mail.dto';

@Controller('admin')
export class AdminController {
  constructor(private readonly mailService: MailService, private readonly userService: UserService) {}

  @Post('mail')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendMail(@Body() sendMailDtoList: SendMailDto[]): Promise<void> {
    for (const sendMailDto of sendMailDtoList) {
      await this.mailService.sendMail(sendMailDto.mail, sendMailDto.salutation, sendMailDto.subject, sendMailDto.body);
    }
  }

  @Get('db/user')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllUser(): Promise<any> {
    return this.userService.getRaw();
  }
}
