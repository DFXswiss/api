import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { EvmUtil } from '../shared/evm/evm.util';
import { Ebel2xClient } from './ebel2x-client';

@Injectable()
export class Ebel2xService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService) {
    const {
      arbitrumGatewayUrl,
      arbitrumApiKey,
      arbitrumWalletPrivateKey,
      arbitrumChainId,
      swapContractAddress,
      quoteContractAddress,
    } = GetConfig().blockchain.arbitrum;

    super(Ebel2xClient, {
      http,
      alchemyService,
      gatewayUrl: arbitrumGatewayUrl,
      apiKey: arbitrumApiKey,
      walletPrivateKey: arbitrumWalletPrivateKey,
      chainId: arbitrumChainId,
      swapContractAddress,
      quoteContractAddress,
    });
  }

  async getMKXPrice(): Promise<number> {
    const pool = await this.getDefaultClient<Ebel2xClient>().getPool();
    const tokenPrice = await pool.poolLogic.tokenPrice();

    return EvmUtil.fromWeiAmount(tokenPrice);
  }
}
