import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BitcoinTestnet4Service } from './bitcoin-testnet4.service';

@Module({
  imports: [SharedModule],
  providers: [BitcoinTestnet4Service],
  exports: [BitcoinTestnet4Service],
})
export class BitcoinTestnet4Module {}
