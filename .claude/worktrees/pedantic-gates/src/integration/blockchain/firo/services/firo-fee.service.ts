import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BitcoinBasedFeeService, FeeConfig } from '../../bitcoin/services/bitcoin-based-fee.service';
import { FiroService } from './firo.service';

@Injectable()
export class FiroFeeService extends BitcoinBasedFeeService {
  constructor(firoService: FiroService) {
    super(firoService.getDefaultClient());
  }

  protected get feeConfig(): FeeConfig {
    return Config.blockchain.firo;
  }
}
