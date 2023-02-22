import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { BtcFeeService } from 'src/integration/blockchain/ain/services/btc-fee.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityManagementSystem } from '../../enums';
import { CorrelationId } from '../../interfaces';
import { CctxExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class KrakenAdapter extends CctxExchangeAdapter {
  #btcClient: BtcClient;

  constructor(
    nodeService: NodeService,
    protected readonly krakenService: KrakenService,
    private readonly feeService: BtcFeeService,
  ) {
    super(LiquidityManagementSystem.KRAKEN, krakenService);

    this.commands.set('depositBTC', this.depositBTC.bind(this));
    this.commands.set('withdrawBTC', this.withdrawBTC.bind(this));

    nodeService.getConnectedNode(NodeType.BTC_OUTPUT).subscribe((client) => (this.#btcClient = client));
  }

  //*** COMMANDS IMPLEMENTATIONS ***//

  private async depositBTC({ blockchain }: Asset, amount: number): Promise<CorrelationId> {
    if (blockchain !== Blockchain.BITCOIN) {
      throw new Error(
        `Liquidity Management KrakenAdapter.depositBTC(...) supports only Bitcoin blockchain, provided ${blockchain} instead`,
      );
    }

    const feeRate = await this.feeService.getRecommendedFeeRate();

    return this.#btcClient.sendMany([{ addressTo: Config.kraken.depositAddresses.Bitcoin, amount }], feeRate);
  }

  private async withdrawBTC({ blockchain, dexName }: Asset, amount: number): Promise<CorrelationId> {
    if (blockchain !== Blockchain.BITCOIN) {
      throw new Error(
        `Liquidity Management KrakenAdapter.withdrawBTC(...) supports only Bitcoin blockchain, provided ${blockchain} instead`,
      );
    }

    const response = await this.krakenService.withdrawFunds(
      dexName,
      amount,
      Config.blockchain.default.btcOutWalletAddress,
      Config.kraken.depositAddressesKeys.Bitcoin,
    );

    return response.id;
  }

  private async withdrawToCake();
}
