import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RefundDataDto } from 'src/subdomains/core/history/dto/refund-data.dto';
import { ChargebackRefundDto } from 'src/subdomains/core/history/dto/transaction-refund.dto';
import { ReviewStatus } from '../kyc/enums/review-status.enum';
import { GenerateOnboardingPdfDto } from './dto/onboarding-pdf.dto';
import {
  CreateSupportNoteDto,
  SupportNoteDto,
  SupportNoteListQuery,
  SupportNoteUserDto,
  UpdateSupportNoteDto,
} from './dto/support-note.dto';
import { TransactionListQuery } from './dto/transaction-list-query.dto';
import {
  CallQueue,
  CallQueueItem,
  CallQueueSummaryEntry,
  KycFileListEntry,
  KycFileYearlyStats,
  PendingReviewItem,
  PendingReviewSummaryEntry,
  PendingReviewType,
  PendingTransactionInfo,
  RecommendationGraph,
  TransactionListEntry,
  UserDataSupportInfoDetails,
  UserDataSupportInfoResult,
  UserDataSupportQuery,
} from './dto/user-data-support.dto';
import { SupportNoteService } from './services/support-note.service';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    private readonly supportNoteService: SupportNoteService,
  ) {}

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

  @Get('pending-transactions')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getPendingTransactions(): Promise<PendingTransactionInfo[]> {
    return this.supportService.getPendingTransactions();
  }

  @Get('pending-reviews')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getPendingReviews(): Promise<PendingReviewSummaryEntry[]> {
    return this.supportService.getPendingReviewsSummary();
  }

  @Get('pending-reviews/items')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getPendingReviewItems(
    @Query('type') type: PendingReviewType,
    @Query('status') status: ReviewStatus,
    @Query('name') name?: string,
  ): Promise<PendingReviewItem[]> {
    return this.supportService.getPendingReviewsList(type, name, status);
  }

  @Get('call-queues')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getCallQueues(): Promise<CallQueueSummaryEntry[]> {
    return this.supportService.getCallQueuesSummary();
  }

  @Get('call-queues/clerks')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getCallQueueClerks(): Promise<string[]> {
    return this.supportService.getCallQueueClerks();
  }

  @Get('call-queues/:queue/items')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getCallQueueItems(@Param('queue', new ParseEnumPipe(CallQueue)) queue: CallQueue): Promise<CallQueueItem[]> {
    return this.supportService.getCallQueueItems(queue);
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
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
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

  @Get('note')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getNotes(@Query() query: SupportNoteListQuery, @GetJwt() jwt: JwtPayload): Promise<SupportNoteDto[]> {
    const notes = await this.supportNoteService.search(jwt.role, query);
    return notes.map((n) => this.supportNoteService.toDto(n, jwt.role, jwt.account));
  }

  @Get('note/users')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async listNoteUsers(@GetJwt() jwt: JwtPayload): Promise<SupportNoteUserDto[]> {
    return this.supportNoteService.listUsers(jwt.role);
  }

  @Post('note')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async createNote(@Body() dto: CreateSupportNoteDto, @GetJwt() jwt: JwtPayload): Promise<SupportNoteDto> {
    const note = await this.supportNoteService.create(jwt.role, jwt.account, dto);
    return this.supportNoteService.toDto(note, jwt.role, jwt.account);
  }

  @Put('note/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async updateNote(
    @Param('id') id: string,
    @Body() dto: UpdateSupportNoteDto,
    @GetJwt() jwt: JwtPayload,
  ): Promise<SupportNoteDto> {
    const note = await this.supportNoteService.update(+id, jwt.role, jwt.account, dto);
    return this.supportNoteService.toDto(note, jwt.role, jwt.account);
  }

  @Delete('note/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async deleteNote(@Param('id') id: string, @GetJwt() jwt: JwtPayload): Promise<void> {
    await this.supportNoteService.delete(+id, jwt.role, jwt.account);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getUserData(@Param('id') id: string, @GetJwt() jwt: JwtPayload): Promise<UserDataSupportInfoDetails> {
    return this.supportService.getUserDataDetails(+id, jwt.role, jwt.account);
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
  async setTransactionRefund(
    @Param('id') id: string,
    @Body() dto: ChargebackRefundDto,
    @GetJwt() jwt: JwtPayload,
  ): Promise<void> {
    await this.supportService.processTransactionRefund(+id, dto, jwt.account);
  }
}
