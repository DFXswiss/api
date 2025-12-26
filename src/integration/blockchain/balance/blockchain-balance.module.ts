import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SolanaModule } from 'src/integration/blockchain/solana/solana.module';
import { TronModule } from 'src/integration/blockchain/tron/tron.module';
import { SharedModule } from 'src/shared/shared.module';
import { BlockchainBalanceController } from './controllers/blockchain-balance.controller';
import { BlockchainBalanceService } from './services/blockchain-balance.service';
import { BlockchainTransactionService } from './services/blockchain-transaction.service';

@Module({
  imports: [SharedModule, AlchemyModule, SolanaModule, TronModule],
  controllers: [BlockchainBalanceController],
  providers: [BlockchainBalanceService, BlockchainTransactionService],
  exports: [BlockchainBalanceService, BlockchainTransactionService],
})
export class BlockchainBalanceModule {}
