import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateSupportIssueDto } from './dto/create-support-issue.dto';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { GetSupportIssueFilter } from './dto/get-support-issue.dto';
import { SupportIssueDto, SupportMessageDto } from './dto/support-issue.dto';
import { UpdateSupportIssueDto } from './dto/update-support-issue.dto';
import { SupportIssue } from './entities/support-issue.entity';
import { CustomerAuthor } from './entities/support-message.entity';
import { SupportIssueService } from './services/support-issue.service';

@ApiTags('Support')
@Controller('support/issue')
export class SupportIssueController {
  constructor(private readonly supportIssueService: SupportIssueService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  async createIssue(@GetJwt() jwt: JwtPayload, @Body() dto: CreateSupportIssueDto): Promise<SupportIssueDto> {
    return this.supportIssueService.createIssue(jwt.account, dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  async getIssue(@GetJwt() jwt: JwtPayload, @Query() query: GetSupportIssueFilter): Promise<SupportIssueDto> {
    return this.supportIssueService.getSupportIssue(jwt.account, query);
  }

  @Post(':id/message')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  async createSupportMessage(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateSupportMessageDto,
  ): Promise<SupportMessageDto> {
    return this.supportIssueService.createSupportMessage(
      +id,
      [UserRole.SUPPORT, UserRole.ADMIN].includes(jwt.role) ? dto : { ...dto, author: CustomerAuthor },
      jwt.account,
    );
  }

  @Get(':id/message/:message-id/file')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  async getFile(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Param('message-id') messageId: string,
  ): Promise<BlobContent> {
    return this.supportIssueService.getSupportIssueFile(jwt.account, +id, +messageId);
  }

  // --- SUPPORT --- //
  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.SUPPORT))
  @ApiExcludeEndpoint()
  async updateSupportIssue(@Param('id') id: string, @Body() dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    return this.supportIssueService.updateSupportIssue(+id, dto);
  }
}
