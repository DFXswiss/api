import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RefundDataDto } from 'src/subdomains/core/history/dto/refund-data.dto';
import { BankRefundDto } from 'src/subdomains/core/history/dto/transaction-refund.dto';
import {
  KycFileListEntry,
  UserDataSupportInfoDetails,
  UserDataSupportInfoResult,
  UserDataSupportQuery,
} from './dto/user-data-support.dto';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async searchUserByKey(@Query() query: UserDataSupportQuery): Promise<UserDataSupportInfoResult> {
    return this.supportService.searchUserDataByKey(query);
  }

  @Get('kycFileList')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getKycFileList(): Promise<KycFileListEntry[]> {
    return this.supportService.getKycFileList();
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getUserData(@Param('id') id: string): Promise<UserDataSupportInfoDetails> {
    return this.supportService.getUserDataDetails(+id);
  }

  @Get('transaction/:id/refund')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @ApiOkResponse({ type: RefundDataDto })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getTransactionRefund(@Param('id') id: string): Promise<RefundDataDto> {
    const refundData = await this.supportService.getTransactionRefundData(+id);
    if (!refundData) throw new NotFoundException('Transaction not found or not refundable');
    return refundData;
  }

  @Put('transaction/:id/refund')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async setTransactionRefund(@Param('id') id: string, @Body() dto: BankRefundDto): Promise<void> {
    const success = await this.supportService.processTransactionRefund(+id, dto);
    if (!success) throw new BadRequestException('Refund failed');
  }
}
