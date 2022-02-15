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
  async sendMail(@Body() dtoList: SendMailDto[]): Promise<void> {
    for (const dto of dtoList) {
      await this.mailService.sendMail(
        dto.to,
        dto.salutation,
        dto.subject,
        dto.body,
        dto.from,
        dto.bcc,
        dto.cc,
        dto.displayName,
      );
    }
  }

  @Get('db')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getRawData(@Query() { table, min }: { table: string; min?: string }): Promise<any> {
    const data = await getConnection()
      .createQueryBuilder()
      .from(table, table)
      .where('id >= :id', { id: +(min ?? 0) })
      .getRawMany()
      .catch((e: Error) => {
        throw new BadRequestException(e.message);
      });

    // transform to array
    const arrayData =
      data.length > 0
        ? {
            keys: Object.keys(data[0]),
            values: data.map((e) => Object.values(e)),
          }
        : undefined;

    //workaround for GS's TODO: Remove
    if (table === 'buy') {
      const userTable = await getConnection()
        .createQueryBuilder()
        .from('user', 'user')
        .getRawMany()
        .catch((e: Error) => {
          throw new BadRequestException(e.message);
        });

      const userIdIndex = arrayData.keys.findIndex((k) => k === 'userId');

      // insert user address at position 2
      arrayData.keys.splice(1, 0, 'address');
      for (const buy of arrayData.values) {
        buy.splice(1, 0, userTable.find((u) => u.id === buy[userIdIndex]).address);
      }
    }

    return arrayData;
  }
}
