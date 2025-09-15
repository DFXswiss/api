import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { CreateRiskAssessmentDto, UpdateRiskAssessmentDto } from '../dto/risk-assessment.dto';
import { UpdateTransactionDto } from '../dto/update-transaction.dto';
import { TransactionRiskAssessment } from '../entities/transaction-risk-assessment.entity';
import { TransactionRiskAssessmentService } from '../services/transaction-risk-assessment.service';

@ApiTags('TransactionAdmin')
@Controller('transaction/admin')
@ApiExcludeController()
export class TransactionAdminController {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly transactionRiskAssessmentService: TransactionRiskAssessmentService,
  ) {}

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  @ApiExcludeEndpoint()
  async updateTransaction(@Param('id') id: string, @Body() dto: UpdateTransactionDto): Promise<Transaction> {
    return this.transactionService.update(+id, dto);
  }

  @Post(':txId/riskAssessment')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  @ApiExcludeEndpoint()
  async createRiskAssessment(
    @Param('txId') txId: string,
    @Body() dto: CreateRiskAssessmentDto,
  ): Promise<TransactionRiskAssessment> {
    return this.transactionRiskAssessmentService.create(+txId, dto);
  }

  @Put(':txId/riskAssessment/:id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  @ApiExcludeEndpoint()
  async updateRiskAssessment(
    @Param('id') id: string,
    @Body() dto: UpdateRiskAssessmentDto,
  ): Promise<TransactionRiskAssessment> {
    return this.transactionRiskAssessmentService.update(+id, dto);
  }
}
