import {
  Controller,
  UseGuards,
  Post,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Put,
  Param,
  Body,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankTxBatch } from './bank-tx-batch.entity';
import { BankTx } from './bank-tx.entity';
import { BankTxService } from './bank-tx.service';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@ApiTags('bankTx')
@Controller('bankTx')
export class BankTxController {
  private readonly logger = new DfxLogger(BankTxController);

  constructor(private readonly bankTxService: BankTxService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.BANKING_BOT))
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
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateBankTxDto): Promise<BankTx> {
    return this.bankTxService.update(+id, dto);
  }
}
