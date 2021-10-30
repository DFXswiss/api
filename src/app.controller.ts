import { Controller, Get, Query, Req, Res, Redirect, Post, UseGuards, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Details, UserAgent } from 'express-useragent';
import { RealIP } from 'nestjs-real-ip';
import { SendMailDto } from './dto/send-mail.dto';
import { RoleGuard } from './shared/auth/role.guard';
import { UserRole } from './shared/auth/user-role.enum';
import { MailService } from './shared/services/mail.service';
import { RefService } from './user/models/referral/ref.service';
@Controller('')
export class AppController {
  constructor(private readonly refService: RefService, readonly mailService: MailService) {}
  @Get()
  @Redirect('api')
  @ApiExcludeEndpoint()
  async home(): Promise<any> {
    // nothing to do (redirect to Swagger UI)
  }

  @Get('app')
  @ApiExcludeEndpoint()
  async createRef(
    @RealIP() ip: string,
    @Query('code') ref: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (ref) await this.refService.addOrUpdate(ip, ref);

    // redirect user depending on platform
    let url = 'https://dfx.swiss';
    const agent = this.getAgentDetails(req);
    if (agent.isAndroid)
      url = 'https://play.app.goo.gl/?link=https://play.google.com/store/apps/details?id=com.defichain.app.dfx';
    if (agent.isiPhone) url = 'https://apps.apple.com/app/id1582633093';

    res.redirect(307, url);
  }

  @Post('sendMail')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendMail(@Body() sendMailDto: SendMailDto[]): Promise<void> {
    sendMailDto.forEach(
      async (entry) => await this.mailService.sendMail(entry.mail, entry.salutation, entry.subject, entry.body),
    );
  }

  private getAgentDetails(req: Request): Details {
    return new UserAgent().parse(req.headers['user-agent'] ?? '');
  }
}
