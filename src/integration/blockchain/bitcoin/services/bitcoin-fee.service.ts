import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BitcoinBasedFeeService, FeeConfig } from './bitcoin-based-fee.service';
import { BitcoinService } from './bitcoin.service';

export { TxFeeRateResult, TxFeeRateStatus } from './bitcoin-based-fee.service';

@Injectable()
export class BitcoinFeeService extends BitcoinBasedFeeService {
  constructor(bitcoinService: BitcoinService) {
    super(bitcoinService.getDefaultClient());
  }

  protected get feeConfig(): FeeConfig {
    return Config.blockchain.default;
  }
}
