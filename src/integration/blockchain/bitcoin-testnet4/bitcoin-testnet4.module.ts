import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BitcoinTestnet4Service } from './bitcoin-testnet4.service';
import { BitcoinTestnet4FeeService } from './services/bitcoin-testnet4-fee.service';

@Module({
  imports: [SharedModule],
  providers: [BitcoinTestnet4Service, BitcoinTestnet4FeeService],
  exports: [BitcoinTestnet4Service, BitcoinTestnet4FeeService],
})
export class BitcoinTestnet4Module {}
