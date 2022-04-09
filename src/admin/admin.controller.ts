import { Controller, Post, UseGuards, Body, Get, Query, BadRequestException, Put } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { BankTxService } from 'src/payment/models/bank-tx/bank-tx.service';
import { CryptoInputService } from 'src/payment/models/crypto-input/crypto-input.service';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MailService } from 'src/shared/services/mail.service';
import { Customer } from 'src/user/services/spider/dto/spider.dto';
import { SpiderApiService } from 'src/user/services/spider/spider-api.service';
import { SpiderService } from 'src/user/services/spider/spider.service';
import { getConnection } from 'typeorm';
import { RenameRefDto } from './dto/rename-ref.dto';
import { SendMailDto } from './dto/send-mail.dto';
import { UploadFileDto } from './dto/upload-file.dto';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly mailService: MailService,
    private readonly spiderService: SpiderService,
    private readonly spiderApiService: SpiderApiService,
    private readonly bankTxService: BankTxService,
    private readonly cryptoInputService: CryptoInputService,
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

  @Put('renameSpiderRef')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async renameReference(@Body() renameRefDto: RenameRefDto): Promise<boolean> {
    return await this.spiderService.renameReference(
      renameRefDto.oldReference,
      renameRefDto.newReference,
      renameRefDto.referenceType,
    );
  }

  @Get('spider')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getSpiderData(@Query('min') min: number, @Query('max') max: number): Promise<Customer[]> {
    const customerList = [];
    for (let id = min; id <= max; id++) {
      customerList.push(await this.spiderApiService.getCustomer(id));
    }
    return customerList;
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
    const id = min ? +min : 1;
    const updated = updatedSince ? new Date(updatedSince) : new Date(0);

    const data = await getConnection()
      .createQueryBuilder()
      .from(table, table)
      .where('id >= :id', { id })
      .andWhere('updated >= :updated', { updated })
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

    // workarounds for GS's
    if (arrayData) {
      switch (table) {
        case 'buy':
          const userTable = await getConnection().createQueryBuilder().from('user', 'user').getRawMany();

          const userIdIndex = arrayData.keys.findIndex((k) => k === 'userId');

          // insert user address at position 2
          arrayData.keys.splice(1, 0, 'address');
          for (const buy of arrayData.values) {
            buy.splice(1, 0, userTable.find((u) => u.id === buy[userIdIndex]).address);
          }
          break;

        case 'bank_tx':
          const bankTxsWithType = await this.bankTxService.getWithType(id, updated);

          // add type
          arrayData.keys.push('cryptoBuyId', 'cryptoSellId', 'returnSourceBankTxId', 'previousRepeatBankTxId', 'type');
          for (const bankTx of arrayData.values) {
            const bankTxWithType = bankTxsWithType.find((f) => bankTx[0] === f.id);
            bankTx.push(
              bankTxWithType?.cryptoBuyId,
              bankTxWithType?.cryptoSellId,
              bankTxWithType?.returnSourceBankTxId,
              bankTxWithType?.previousRepeatBankTxId,
              bankTxWithType?.type,
            );
          }
          break;

        case 'crypto_input':
          const cryptoInputsWithType = await this.cryptoInputService.getWithType(id, updated);

          // add type
          arrayData.keys.push('cryptoSellId', 'cryptoStakingId', 'type');
          for (const cryptoInput of arrayData.values) {
            const cryptoInputWithType = cryptoInputsWithType.find((f) => cryptoInput[0] === f.id);
            cryptoInput.push(
              cryptoInputWithType?.cryptoSellId,
              cryptoInputWithType?.cryptoStakingId,
              cryptoInputWithType?.type,
            );
          }
          break;
      }
    }

    return arrayData;
  }
}
