import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AlchemyService } from '../src/integration/alchemy/services/alchemy.service';
import { Blockchain } from '../src/integration/blockchain/shared/enums/blockchain.enum';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const alchemyService = app.get(AlchemyService);
  
  // Get current block
  const currentBlock = await alchemyService.getBlockNumber(Blockchain.ETHEREUM);
  console.log('Current Ethereum block:', currentBlock);
  
  // Sync transactions for the deposit address
  // Look back ~100 blocks to catch recent transactions
  const fromBlock = currentBlock - 100;
  
  console.log(`Syncing transactions from block ${fromBlock} to ${currentBlock}`);
  console.log('Address: 0x67D56791f49ab4f4d44b552c80c3C36468B30DF2');
  
  await alchemyService.syncTransactions({
    blockchain: Blockchain.ETHEREUM,
    fromBlock: fromBlock,
    toBlock: currentBlock,
    address: '0x67D56791f49ab4f4d44b552c80c3C36468B30DF2',
  });
  
  console.log('Sync completed! Check API logs for pay-in detection.');
  
  await app.close();
}

bootstrap().catch(console.error);
