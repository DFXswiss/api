import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateSupportMessageDto } from 'src/subdomains/supporting/support-issue/dto/create-support-message.dto';
import { GetSupportIssueListFilter } from 'src/subdomains/supporting/support-issue/dto/get-support-issue.dto';
import {
  SupportIssueInternalDataDto,
  SupportIssueListDto,
  SupportIssueStatisticsDto,
  SupportMessageDto,
} from 'src/subdomains/supporting/support-issue/dto/support-issue.dto';
import { UpdateSupportIssueDto } from 'src/subdomains/supporting/support-issue/dto/update-support-issue.dto';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportIssueInternalState } from 'src/subdomains/supporting/support-issue/enums/support-issue.enum';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { RealUnitScopeService } from '../realunit-scope.service';

// RealUnit tenant support dashboard: lets RealUnit staff (UserRole.REALUNIT) manage ONLY their own customers'
// support issues. Every endpoint is strictly customer-scoped and fail-closed; the DFX RoleGuard is never widened
// and no Department.REALUNIT exists. Aggregates are filtered by the RealUnit customer id set; single-issue routes
// enforce membership before any data or mutation (fail-closed 404 for a foreign or unknown id).
@ApiTags('Realunit')
@Controller('realunit/support')
export class RealUnitSupportController {
  constructor(
    private readonly supportIssueService: SupportIssueService,
    private readonly scopeService: RealUnitScopeService,
  ) {}

  @Get('list')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getSupportIssueList(
    @GetJwt() jwt: JwtPayload,
    @Query() filter: GetSupportIssueListFilter,
  ): Promise<{ data: SupportIssueListDto[]; total: number }> {
    const customerIds = await this.scopeService.getCustomerIds();
    return this.supportIssueService.getSupportIssueList(filter, jwt.role, customerIds);
  }

  @Get('counts')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getSupportIssueCounts(@GetJwt() jwt: JwtPayload): Promise<Record<SupportIssueInternalState, number>> {
    const customerIds = await this.scopeService.getCustomerIds();
    return this.supportIssueService.getSupportIssueCounts(jwt.role, customerIds);
  }

  @Get('statistics')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getSupportIssueStatistics(
    @GetJwt() jwt: JwtPayload,
    @Query('days') days?: string,
  ): Promise<SupportIssueStatisticsDto> {
    const customerIds = await this.scopeService.getCustomerIds();
    return this.supportIssueService.getSupportIssueStatistics(jwt.role, days ? +days : undefined, customerIds);
  }

  @Get('activity')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getSupportIssueActivity(
    @GetJwt() jwt: JwtPayload,
    @Query('since') since?: string,
  ): Promise<{ count: number; latestAt?: Date }> {
    const customerIds = await this.scopeService.getCustomerIds();
    return this.supportIssueService.getSupportIssueActivity(since ? new Date(since) : undefined, jwt.role, customerIds);
  }

  @Get('clerks')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getRealUnitSupportClerks(): Promise<string[]> {
    return this.supportIssueService.getRealUnitSupportClerks();
  }

  @Get(':id/data')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getIssueData(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<SupportIssueInternalDataDto> {
    const customerIds = await this.scopeService.getCustomerIds();
    await this.assertIssueOwnership(+id); // membership before returning; getIssueData(customerIds) also enforces it
    return this.supportIssueService.getIssueData(+id, jwt.role, customerIds);
  }

  // Scoped message thread by numeric issue id — the tenant-isolated replacement for the shared uid-keyed
  // support/issue/:uid endpoint. Membership is enforced server-side (fail-closed 404 for a foreign/unknown id).
  @Get(':id/messages')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getIssueMessages(
    @Param('id') id: string,
    @Query('fromMessageId') fromMessageId?: string,
  ): Promise<SupportMessageDto[]> {
    const customerIds = await this.scopeService.getCustomerIds();
    await this.assertIssueOwnership(+id); // membership before returning; getIssueMessages(customerIds) also enforces it
    return this.supportIssueService.getIssueMessages(+id, customerIds, fromMessageId ? +fromMessageId : undefined);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async updateSupportIssue(@Param('id') id: string, @Body() dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    await this.assertIssueOwnership(+id);
    return this.supportIssueService.updateIssue(+id, dto);
  }

  @Post(':id/message')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async createSupportMessage(
    @Param('id') id: string,
    @Body() dto: CreateSupportMessageDto,
  ): Promise<SupportMessageDto> {
    await this.assertIssueOwnership(+id);
    return this.supportIssueService.createMessageSupport(+id, dto);
  }

  @Get(':id/message/:messageId/file')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getFile(@Param('id') id: string, @Param('messageId') messageId: string): Promise<BlobContent> {
    const userDataId = await this.assertIssueOwnership(+id);
    return this.supportIssueService.getIssueFile(id, +messageId, userDataId);
  }

  // --- HELPER METHODS --- //

  // Enforces the RealUnit tenant boundary for a single issue: resolves the owning userData id and asserts it is a
  // RealUnit customer, throwing NotFound (fail-closed 404, no existence leak) for a foreign or unknown issue.
  private async assertIssueOwnership(issueId: number): Promise<number> {
    const userDataId = await this.supportIssueService.getIssueUserDataId(issueId);
    await this.scopeService.assertCustomer(userDataId);

    return userDataId;
  }
}
