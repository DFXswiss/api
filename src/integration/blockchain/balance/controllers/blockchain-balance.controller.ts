import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import {
  BroadcastResultDto,
  BroadcastTransactionDto,
  CreateTransactionDto,
  UnsignedTransactionDto,
} from '../dto/create-transaction.dto';
import { GetBalancesDto, GetBalancesResponseDto } from '../dto/get-balances.dto';
import { BlockchainBalanceService } from '../services/blockchain-balance.service';
import { BlockchainTransactionService } from '../services/blockchain-transaction.service';

@ApiTags('Blockchain')
@Controller('blockchain')
export class BlockchainBalanceController {
  constructor(
    private readonly blockchainBalanceService: BlockchainBalanceService,
    private readonly blockchainTransactionService: BlockchainTransactionService,
  ) {}

  @Post('balances')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), UserActiveGuard())
  @ApiOkResponse({ type: GetBalancesResponseDto })
  async getBalances(@Body() dto: GetBalancesDto): Promise<GetBalancesResponseDto> {
    return this.blockchainBalanceService.getBalances(dto);
  }

  @Post('transaction')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), UserActiveGuard())
  @ApiOkResponse({ type: UnsignedTransactionDto })
  async createTransaction(@Body() dto: CreateTransactionDto): Promise<UnsignedTransactionDto> {
    return this.blockchainTransactionService.createTransaction(dto);
  }

  @Post('broadcast')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), UserActiveGuard())
  @ApiOkResponse({ type: BroadcastResultDto })
  async broadcastTransaction(@Body() dto: BroadcastTransactionDto): Promise<BroadcastResultDto> {
    return this.blockchainTransactionService.broadcastTransaction(dto);
  }
}
