import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
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
import { GenerateOnboardingPdfDto } from './dto/onboarding-pdf.dto';
import { TransactionListQuery } from './dto/transaction-list-query.dto';
import {
  KycFileListEntry,
  KycFileYearlyStats,
  PendingOnboardingInfo,
  RecommendationGraph,
  TransactionListEntry,
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
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
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

  @Get('kycFileStats')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getKycFileStats(): Promise<KycFileYearlyStats[]> {
    return this.supportService.getKycFileStats();
  }

  @Get('transactionList')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getTransactionList(@Query() query: TransactionListQuery): Promise<TransactionListEntry[]> {
    return this.supportService.getTransactionList(query);
  }

  @Get('recommendation-graph/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getRecommendationGraph(@Param('id') id: string): Promise<RecommendationGraph> {
    return this.supportService.getRecommendationGraph(+id);
  }

  @Get('pending-onboardings')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getPendingOnboardings(): Promise<PendingOnboardingInfo[]> {
    return this.supportService.getPendingOnboardings();
  }

  @Get(':id/ip-log-pdf')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getIpLogPdf(@Param('id') id: string): Promise<{ pdfData: string }> {
    const pdfData = await this.supportService.generateIpLogPdf(+id);
    return { pdfData };
  }

  @Get(':id/transaction-pdf')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getTransactionPdf(@Param('id') id: string): Promise<{ pdfData: string }> {
    const pdfData = await this.supportService.generateTransactionPdf(+id);
    return { pdfData };
  }

  @Post(':id/onboarding-pdf')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async generateOnboardingPdf(
    @Param('id') id: string,
    @Body() dto: GenerateOnboardingPdfDto,
  ): Promise<{ pdfData: string; fileName: string }> {
    return this.supportService.generateAndSaveOnboardingPdf(+id, dto);
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
