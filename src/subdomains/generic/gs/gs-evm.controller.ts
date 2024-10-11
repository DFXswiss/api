import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ethers } from 'ethers';
import { EvmBridgeApproval, EvmContractApproval } from 'src/integration/blockchain/shared/evm/dto/evm-approval.dto';
import { EvmCoinTransactionDto } from 'src/integration/blockchain/shared/evm/dto/evm-coin-transaction.dto';
import { EvmRawInputDataDto } from 'src/integration/blockchain/shared/evm/dto/evm-raw-input-data.dto';
import { EvmTokenTransactionDto } from 'src/integration/blockchain/shared/evm/dto/evm-token-transaction.dto';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { EvmRawTransactionDto } from '../../../integration/blockchain/shared/evm/dto/evm-raw-transaction.dto';
import { GsEvmService } from './gs-evm.service';

@Controller('gs/evm')
export class GsEvmController {
  constructor(private readonly gsEvmService: GsEvmService) {}

  @Post('rawTransaction')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendRawTransaction(@Body() dto: EvmRawTransactionDto): Promise<ethers.providers.TransactionResponse> {
    return this.gsEvmService.sendRawTransaction(dto);
  }

  @Post('rawInputData')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendRawInputData(@Body() dto: EvmRawInputDataDto): Promise<ethers.providers.TransactionResponse> {
    return this.gsEvmService.sendRawInputData(dto);
  }

  @Post('tokenTransaction')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendTokenTransaction(@Body() dto: EvmTokenTransactionDto): Promise<string> {
    return this.gsEvmService.sendTokenTransaction(dto);
  }

  @Post('coinTransaction')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async sendCoinTransaction(@Body() dto: EvmCoinTransactionDto): Promise<string> {
    return this.gsEvmService.sendCoinTransaction(dto);
  }

  @Post('bridgeApproval')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async approveBridge(@Body() dto: EvmBridgeApproval): Promise<string> {
    return this.gsEvmService.approveBridge(dto);
  }

  @Post('contractApproval')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async approveContract(@Body() dto: EvmContractApproval): Promise<string> {
    return this.gsEvmService.approveContract(dto);
  }
}
