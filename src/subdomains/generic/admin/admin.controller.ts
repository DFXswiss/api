import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { LetterService } from 'src/integration/letter/letter.service';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CustodyService } from 'src/subdomains/core/custody/services/custody-service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { AdminService } from './admin.service';
import { PayoutRequestDto } from './dto/payout-request.dto';
import { SendLetterDto } from './dto/send-letter.dto';
import { SendMailDto } from './dto/send-mail.dto';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly notificationService: NotificationService,
    private readonly letterService: LetterService,
    private readonly custodyService: CustodyService,
  ) {}

  @Post('mail')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async sendMail(@Body() dtoList: SendMailDto[]): Promise<void> {
    for (const dto of dtoList) {
      if (dto.template === 'default') dto.template = 'user';
      await this.notificationService.sendMail({ type: MailType.GENERIC, context: MailContext.CUSTOM, input: dto });
    }
  }

  @Post('sendLetter')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async sendLetter(@Body() sendLetterDto: SendLetterDto): Promise<boolean> {
    return this.letterService.sendLetter(sendLetterDto);
  }

  @Post('payout')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async payout(@Body() request: PayoutRequestDto): Promise<void> {
    return this.adminService.payout(request);
  }
}
