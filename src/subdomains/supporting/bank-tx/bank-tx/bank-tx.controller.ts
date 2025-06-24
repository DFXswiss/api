import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Put,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { BankTxBatch } from './entities/bank-tx-batch.entity';
import { BankTx } from './entities/bank-tx.entity';
import { BankTxService } from './services/bank-tx.service';

@ApiTags('bankTx')
@Controller('bankTx')
export class BankTxController {
  constructor(private readonly logger: DfxLoggerService, private readonly bankTxService: BankTxService) {
    this.logger.create(BankTxController);
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.BANKING_BOT), UserActiveGuard())
  @UseInterceptors(FilesInterceptor('files'))
  async uploadSepaFiles(@UploadedFiles() files: Express.Multer.File[]): Promise<(BankTxBatch | Error)[]> {
    const batches = [];
    for (const file of files) {
      try {
        const batch = await this.bankTxService.storeSepaFile(file.buffer.toString());
        batches.push(batch);
      } catch (e) {
        this.logger.error(`Failed to store SEPA file:`, e);
        throw new BadRequestException(`Failed to store SEPA file`, { description: e.message });
      }
    }

    return batches;
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async update(@Param('id') id: string, @Body() dto: UpdateBankTxDto): Promise<BankTx> {
    return this.bankTxService.update(+id, dto);
  }

  @Delete(':id/buyCrypto')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async reset(@Param('id') id: string): Promise<void> {
    return this.bankTxService.reset(+id);
  }
}
