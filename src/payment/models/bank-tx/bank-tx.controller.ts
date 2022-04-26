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
  Get,
  Query,
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

@ApiTags('bankTx')
@Controller('bankTx')
export class BankTxController {
  constructor(private readonly bankTxService: BankTxService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UseInterceptors(FilesInterceptor('files'))
  async uploadSepaFiles(@UploadedFiles() files: Express.Multer.File[]): Promise<(BankTxBatch | Error)[]> {
    const batches = await this.bankTxService.storeSepaFiles(files.map((f) => f.buffer.toString()));

    if (batches.some((r) => r instanceof Error)) throw new BadRequestException(batches);
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
