import {
  Controller,
  Post,
  UseGuards,
  Body,
  Get,
  Query,
  BadRequestException,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MailService } from 'src/shared/services/mail.service';
import { KycService } from 'src/user/models/kyc/kyc.service';
import { getConnection } from 'typeorm';
import { SendMailDto } from './dto/send-mail.dto';
import { UploadFileDto } from './dto/upload-file.dto';

@Controller('admin')
export class AdminController {
  constructor(private readonly mailService: MailService, private readonly kycService: KycService) {}

  @Post('mail')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendMail(@Body() dtoList: SendMailDto[]): Promise<void> {
    for (const dto of dtoList) {
      await this.mailService.sendMail(dto);
    }
  }

  @Post('upload')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UseInterceptors(FilesInterceptor('files'))
  async uploadFile(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() updateFileDto: UploadFileDto,
  ): Promise<boolean> {
    return this.kycService.uploadDocument(updateFileDto.userDataId, files[0], updateFileDto.documentType);
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
