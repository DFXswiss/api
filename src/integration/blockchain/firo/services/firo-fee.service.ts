import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BitcoinBasedFeeService } from '../../bitcoin/services/bitcoin-based-fee.service';
import { FiroService } from './firo.service';

@Injectable()
export class FiroFeeService extends BitcoinBasedFeeService {
  constructor(firoService: FiroService) {
    super(firoService.getDefaultClient());
  }

  async getSendFeeRate(): Promise<number> {
    const baseRate = await this.getRecommendedFeeRate();

    const { allowUnconfirmedUtxos, cpfpFeeMultiplier, defaultFeeMultiplier } = Config.blockchain.firo;
    const multiplier = allowUnconfirmedUtxos ? cpfpFeeMultiplier : defaultFeeMultiplier;

    return baseRate * multiplier;
  }
}
