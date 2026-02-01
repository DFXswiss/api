import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateSupportIssueDto, CreateSupportIssueSupportDto } from './dto/create-support-issue.dto';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { GetSupportIssueFilter } from './dto/get-support-issue.dto';
import { SupportIssueDto, SupportMessageDto } from './dto/support-issue.dto';
import { UpdateSupportIssueDto } from './dto/update-support-issue.dto';
import { SupportIssue } from './entities/support-issue.entity';
import { CustomerAuthor } from './entities/support-message.entity';
import { Department } from './enums/department.enum';
import { SupportIssueType } from './enums/support-issue.enum';
import { SupportIssueService } from './services/support-issue.service';

@ApiTags('Support')
@Controller('support/issue')
export class SupportIssueController {
  constructor(private readonly supportIssueService: SupportIssueService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
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
  ): Promise<SupportIssueDto> {
    return this.supportIssueService.createIssue(+userDataId, dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT))
  async getIssues(@GetJwt() jwt: JwtPayload): Promise<SupportIssueDto[]> {
    return this.supportIssueService.getIssues(jwt?.account);
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

  @Post(':id/message')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  async createSupportMessage(
    @GetJwt() jwt: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() dto: CreateSupportMessageDto,
  ): Promise<SupportMessageDto> {
    return [UserRole.SUPPORT, UserRole.COMPLIANCE, UserRole.ADMIN].includes(jwt?.role)
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

  // --- SUPPORT --- //
  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  @ApiExcludeEndpoint()
  async updateSupportIssue(@Param('id') id: string, @Body() dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    return this.supportIssueService.updateIssue(+id, dto);
  }
}
