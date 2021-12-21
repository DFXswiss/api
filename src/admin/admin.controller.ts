import { Controller, Post, UseGuards, Body, Get, Query, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MailService } from 'src/shared/services/mail.service';
import { getConnection } from 'typeorm';
import { SendMailDto } from './dto/send-mail.dto';

@Controller('admin')
export class AdminController {
  constructor(private readonly mailService: MailService) {}

  @Post('mail')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendMail(@Body() sendMailDtoList: SendMailDto[]): Promise<void> {
    for (const sendMailDto of sendMailDtoList) {
      await this.mailService.sendMail(sendMailDto.mail, sendMailDto.salutation, sendMailDto.subject, sendMailDto.body);
    }
  }

  @Get('db')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getRawData(@Query('table') table: string): Promise<any> {
    const data = await getConnection()
      .createQueryBuilder()
      .from(table, table)
      .getRawMany()
      .catch((e) => {
        throw new BadRequestException(e);
      });

    if (table === 'buy') {
      //workaround for GS's TODO: Remove

      const userTable = await getConnection()
        .createQueryBuilder()
        .from('user', 'user')
        .getRawMany()
        .catch((e) => {
          throw new BadRequestException(e);
        });

      for (const buy of data) {
        buy['address'] = userTable.find((u) => u.id === buy.userId).address;
      }
    }

    // transform to array
    return data.length > 0
      ? {
          keys: Object.keys(data[0]),
          values: data.map((e) => Object.values(e)),
        }
      : undefined;
  }
}
