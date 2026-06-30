import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBadRequestResponse, ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BindEscalationChatDto } from './dto/bind-escalation-chat.dto';
import { CreateSupportIssueDto, CreateSupportIssueSupportDto } from './dto/create-support-issue.dto';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { GetSupportIssueFilter, GetSupportIssueListFilter } from './dto/get-support-issue.dto';
import {
  SupportIssueDto,
  SupportIssueInternalDataDto,
  SupportIssueListDto,
  SupportIssueStatisticsDto,
  SupportMessageDto,
} from './dto/support-issue.dto';
import { UpdateSupportIssueDto } from './dto/update-support-issue.dto';
import { SupportIssue } from './entities/support-issue.entity';
import { CustomerAuthor } from './entities/support-message.entity';
import { Department } from './enums/department.enum';
import { SupportIssueInternalState, SupportIssueType } from './enums/support-issue.enum';
import { SupportEscalationService, TelegramChat } from './services/support-escalation.service';
import { SupportIssueService } from './services/support-issue.service';

@ApiTags('Support')
@Controller('support/issue')
export class SupportIssueController {
  constructor(
    private readonly supportIssueService: SupportIssueService,
    private readonly supportEscalationService: SupportEscalationService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBadRequestResponse({
    description:
      'Includes prerequisite failures (e.g. missing email — register first via POST /v1/realunit/register/email) and request-validation failures. Pre-tap state is exposed via /v2/user as the createSupportTicket capability.',
  })
  async createIssue(
    @GetJwt() jwt: JwtPayload | undefined,
    @Body() dto: CreateSupportIssueDto,
  ): Promise<SupportIssueDto> {
    const input: CreateSupportIssueDto = {
      ...dto,
      author: CustomerAuthor,
      department:
        dto.type === SupportIssueType.VERIFICATION_CALL || dto.limitRequest
          ? Department.COMPLIANCE
          : Department.SUPPORT,
    };
    return jwt?.account
      ? this.supportIssueService.createIssue(jwt.account, input)
      : this.supportIssueService.createTransactionRequestIssue(input);
  }

  @Post('support')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async createIssueBySupport(
    @Query('userDataId') userDataId: string,
    @Body() dto: CreateSupportIssueSupportDto,
    @GetJwt() jwt: JwtPayload,
  ): Promise<SupportIssueDto> {
    const input: CreateSupportIssueSupportDto = {
      ...dto,
      department: jwt.role === UserRole.COMPLIANCE ? Department.COMPLIANCE : Department.SUPPORT,
    };
    return this.supportIssueService.createIssue(+userDataId, input);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT))
  async getIssues(@GetJwt() jwt: JwtPayload): Promise<SupportIssueDto[]> {
    return this.supportIssueService.getIssues(jwt?.account);
  }

  @Get('list')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getSupportIssueList(
    @GetJwt() jwt: JwtPayload,
    @Query() filter: GetSupportIssueListFilter,
  ): Promise<{ data: SupportIssueListDto[]; total: number }> {
    return this.supportIssueService.getSupportIssueList(filter, jwt.role);
  }

  @Get('counts')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getSupportIssueCounts(@GetJwt() jwt: JwtPayload): Promise<Record<SupportIssueInternalState, number>> {
    return this.supportIssueService.getSupportIssueCounts(jwt.role);
  }

  @Get('statistics')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getSupportIssueStatistics(
    @GetJwt() jwt: JwtPayload,
    @Query('days') days?: string,
  ): Promise<SupportIssueStatisticsDto> {
    return this.supportIssueService.getSupportIssueStatistics(jwt.role, days ? +days : undefined);
  }

  @Get('escalation/telegram-chats')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getEscalationChats(): Promise<TelegramChat[]> {
    return this.supportEscalationService.getGroupChats();
  }

  @Post('escalation/telegram-bind')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async bindEscalationChat(@Body() dto: BindEscalationChatDto): Promise<{ chat: TelegramChat | null }> {
    return { chat: (await this.supportEscalationService.bindGroupChat(dto.chatId)) ?? null };
  }

  @Post('escalation/telegram-test')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async testEscalationChat(): Promise<{ sent: boolean }> {
    return { sent: await this.supportEscalationService.sendTestMessage() };
  }

  @Get('activity')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getSupportIssueActivity(
    @GetJwt() jwt: JwtPayload,
    @Query('since') since?: string,
  ): Promise<{ count: number; latestAt?: Date }> {
    return this.supportIssueService.getSupportIssueActivity(since ? new Date(since) : undefined, jwt.role);
  }

  @Get('clerks')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getSupportIssueClerks(): Promise<string[]> {
    return this.supportIssueService.getSupportIssueClerks();
  }

  @Get('clerk')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getSupportIssueClerk(@GetJwt() jwt: JwtPayload): Promise<{ clerk: string | null }> {
    return { clerk: (await this.supportIssueService.getSupportIssueClerkForAccount(jwt.account)) ?? null };
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  async getIssue(
    @GetJwt() jwt: JwtPayload | undefined,
    @Param('id') id: string,
    @Query() query: GetSupportIssueFilter,
  ): Promise<SupportIssueDto> {
    return this.supportIssueService.getIssue(id, query, jwt?.account);
  }

  @Get(':id/data')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getIssueData(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<SupportIssueInternalDataDto> {
    return this.supportIssueService.getIssueData(+id, jwt.role);
  }

  @Post(':id/message')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  async createSupportMessage(
    @GetJwt() jwt: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() dto: CreateSupportMessageDto,
  ): Promise<SupportMessageDto> {
    return jwt?.role && [UserRole.SUPPORT, UserRole.COMPLIANCE, UserRole.ADMIN].includes(jwt.role)
      ? this.supportIssueService.createMessageSupport(+id, dto)
      : this.supportIssueService.createMessage(id, dto, jwt?.account);
  }

  @Get(':id/message/:messageId/file')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  async getFile(
    @GetJwt() jwt: JwtPayload | undefined,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ): Promise<BlobContent> {
    return this.supportIssueService.getIssueFile(id, +messageId, jwt?.account);
  }

  @Put(':id/close')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  async closeIssue(@GetJwt() jwt: JwtPayload | undefined, @Param('id') id: string): Promise<SupportIssueDto> {
    return this.supportIssueService.closeIssue(id, jwt?.account);
  }

  // --- SUPPORT --- //
  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  @ApiExcludeEndpoint()
  async updateSupportIssue(@Param('id') id: string, @Body() dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    return this.supportIssueService.updateIssue(+id, dto);
  }
}
