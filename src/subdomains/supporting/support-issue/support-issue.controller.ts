import { Body, Controller, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateTransactionIssueDto } from './dto/create-support-issue.dto';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { UpdateSupportIssueDto } from './dto/update-support-issue.dto';
import { SupportIssue } from './entities/support-issue.entity';
import { SupportIssueService } from './services/support-issue.service';

@ApiTags('Support')
@Controller('support/issue')
export class SupportIssueController {
  constructor(private readonly supportIssueService: SupportIssueService) {}

  @Post('transaction')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createTransactionIssue(
    @GetJwt() jwt: JwtPayload,
    @Query('id') transactionId: string,
    @Body() dto: CreateTransactionIssueDto,
  ): Promise<void> {
    return this.supportIssueService.createTransactionIssue(jwt.id, +transactionId, dto);
  }

  @Post(':id/message')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createSupportMessage(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateSupportMessageDto,
  ): Promise<void> {
    return this.supportIssueService.createSupportMessage(
      +id,
      [UserRole.SUPPORT, UserRole.ADMIN].includes(jwt.role) ? dto : { ...dto, author: 'Customer' },
      jwt.id,
    );
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
