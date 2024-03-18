import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { ArbitrumClient } from '../arbitrum/arbitrum-client';
import { ArbitrumService } from '../arbitrum/arbitrum.service';
import { EvmUtil } from '../shared/evm/evm.util';

@Injectable()
export class Ebel2xService {
  private readonly client: ArbitrumClient;

  constructor(arbitrumService: ArbitrumService) {
    this.client = arbitrumService.getDefaultClient();
  }

  async getMKXPrice(): Promise<number> {
    const ebel2xContract = this.client.getERC20ContractForDex(Config.blockchain.ebel2x.contractAddress);
    const price = await ebel2xContract.price();

    return EvmUtil.fromWeiAmount(price);
  }
}
