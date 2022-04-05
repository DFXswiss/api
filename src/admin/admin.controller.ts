import { Controller, Post, UseGuards, Body, Get, Query, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { BankTxService } from 'src/payment/models/bank-tx/bank-tx.service';
import { CryptoInputService } from 'src/payment/models/crypto-input/crypto-input.service';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MailService } from 'src/shared/services/mail.service';
import { SpiderService } from 'src/user/services/spider/spider.service';
import { getConnection } from 'typeorm';
import { SendMailDto } from './dto/send-mail.dto';
import { UploadFileDto } from './dto/upload-file.dto';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly mailService: MailService,
    private readonly spiderService: SpiderService,
    private readonly bankTxService: BankTxService,
    private readonly cryptoImportService: CryptoInputService,
  ) {}

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
  async uploadFile(@Body() updateFileDto: UploadFileDto): Promise<boolean> {
    const byteSplit = updateFileDto.data.split(',');

    const buffer = new Uint8Array(byteSplit.length);

    for (let a = 0; a < byteSplit.length; a++) {
      buffer[a] = Number.parseInt(byteSplit[a]);
    }

    return await this.spiderService.uploadDocument(
      updateFileDto.userDataId,
      false,
      updateFileDto.documentType,
      updateFileDto.originalName,
      updateFileDto.contentType,
      buffer,
    );
  }

  @Get('db')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getRawData(
    @Query() { table, min, updatedSince }: { table: string; min?: string; updatedSince?: string },
  ): Promise<any> {
    let query = getConnection().createQueryBuilder().from(table, table);

    if (min != null) {
      query = query.where('id >= :id', { id: +min });
    } else if (updatedSince != null) {
      query = query.where('updated >= :updated', { updated: new Date(updatedSince) });
    }

    const data = await query.getRawMany().catch((e: Error) => {
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
    if (arrayData && table === 'buy') {
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
    } else if (arrayData && table === 'bank_tx') {
      const bankTxType = await this.bankTxService.getWithType(+min, new Date(updatedSince));

      arrayData.keys.push('type');
      for (const bankTx of arrayData.values) {
        bankTx.push(bankTxType.find((f) => bankTx[0] === f.id).type);
      }
    } else if (arrayData && table === 'crypto_input') {
      const cryptoInputType = await this.cryptoImportService.getWithType(+min, new Date(updatedSince));

      arrayData.keys.push('type');
      for (const cryptoInput of arrayData.values) {
        cryptoInput.push(cryptoInputType.find((f) => cryptoInput[0] === f.id).type);
      }
    }

    return arrayData;
  }
}
