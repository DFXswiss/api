import {
  Erc20Bridger,
  EthBridger,
  L2Network,
  L2ToL1MessageStatus,
  L2TransactionReceipt,
  getL2Network,
} from '@arbitrum/sdk';
import { EthDepositParams } from '@arbitrum/sdk/dist/lib/assetBridger/ethBridger';
import {
  L1ContractCallTransactionReceipt,
  L1EthDepositTransactionReceipt,
} from '@arbitrum/sdk/dist/lib/message/L1Transaction';
import { Contract, ethers } from 'ethers';
import { GetConfig } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { Util } from 'src/shared/utils/util';
import ERC20_ABI from '../shared/evm/abi/erc20.abi.json';
import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { L2BridgeEvmClient } from '../shared/evm/interfaces';

export class ArbitrumClient extends EvmClient implements L2BridgeEvmClient {
  private logger: DfxLoggerService;

  private readonly l1Provider: ethers.providers.JsonRpcProvider;
  private readonly l1Wallet: ethers.Wallet;
  private l2Network: L2Network;

  constructor(params: EvmClientParams) {
    super(params);

    this.logger = params.logger;
    this.logger.create(ArbitrumClient);

    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey } = GetConfig().blockchain.ethereum;
    const ethereumGateway = `${ethGatewayUrl}/${ethApiKey ?? ''}`;

    this.l1Provider = new ethers.providers.JsonRpcProvider(ethereumGateway);
    this.l1Wallet = new ethers.Wallet(ethWalletPrivateKey, this.l1Provider);

    void this.initL2Network();
  }

  async depositCoinOnDex(amount: number): Promise<string> {
    const ethBridger = new EthBridger(this.l2Network);

    const depositTx = await ethBridger.deposit({
      amount: EvmUtil.toWeiAmount(amount),
      l1Signer: this.l1Wallet,
      l2Provider: this.provider,
    } as EthDepositParams);

    return depositTx.hash;
  }

  async withdrawCoinOnDex(amount: number): Promise<string> {
    const ethBridger = new EthBridger(this.l2Network);

    const withdrawTx = await ethBridger.withdraw({
      amount: EvmUtil.toWeiAmount(amount),
      l2Signer: this.wallet,
      from: this.wallet.address,
      destinationAddress: this.l1Wallet.address,
    });

    return withdrawTx.hash;
  }

  async approveBridge(l1Token: Asset, _l2Token: Asset): Promise<string> {
    const erc20Bridge = new Erc20Bridger(this.l2Network);

    const approveTx = await erc20Bridge.approveToken({
      l1Signer: this.l1Wallet,
      erc20L1Address: l1Token.chainId,
    });

    return approveTx.hash;
  }

  async depositTokenOnDex(l1Token: Asset, _l2Token: Asset, amount: number): Promise<string> {
    const erc20Bridge = new Erc20Bridger(this.l2Network);

    const depositTx = await erc20Bridge.deposit({
      amount: EvmUtil.toWeiAmount(amount, l1Token.decimals),
      erc20L1Address: l1Token.chainId,
      l1Signer: this.l1Wallet,
      l2Provider: this.provider,
    });

    return depositTx.hash;
  }

  async withdrawTokenOnDex(l1Token: Asset, _l2Token: Asset, amount: number): Promise<string> {
    const erc20Bridge = new Erc20Bridger(this.l2Network);

    const withdrawTx = await erc20Bridge.withdraw({
      amount: EvmUtil.toWeiAmount(amount, l1Token.decimals),
      destinationAddress: this.l1Wallet.address,
      erc20l1Address: l1Token.chainId,
      l2Signer: this.wallet,
    });

    return withdrawTx.hash;
  }

  async checkL2BridgeCompletion(l1TxId: string, asset: Asset): Promise<boolean> {
    try {
      const txReceipt = await Util.timeout(this.l1Provider.getTransactionReceipt(l1TxId), 10000);
      const l1TxReceipt =
        asset.type === AssetType.COIN
          ? new L1EthDepositTransactionReceipt(txReceipt)
          : new L1ContractCallTransactionReceipt(txReceipt);

      const result = await Util.timeout<{ complete: boolean }>(l1TxReceipt.waitForL2(this.provider), 10000);

      return result.complete;
    } catch {
      return false;
    }
  }

  async checkL1BridgeCompletion(l2TxId: string, _asset: Asset): Promise<boolean> {
    try {
      const txReceipt = await Util.timeout(this.provider.getTransactionReceipt(l2TxId), 10000);
      const l2TxReceipt = new L2TransactionReceipt(txReceipt);
      const l2ToL1Messages = await Util.timeout(l2TxReceipt.getL2ToL1Messages(this.l1Wallet), 10000);

      const status = await l2ToL1Messages[0].status(this.provider);

      if (status === L2ToL1MessageStatus.CONFIRMED) {
        await l2ToL1Messages[0].execute(this.provider);
      }

      return status === L2ToL1MessageStatus.EXECUTED;
    } catch {
      return false;
    }
  }

  //*** HELPER METHODS ***//

  private async initL2Network() {
    try {
      this.l2Network = await getL2Network(this.provider);
    } catch (e) {
      this.logger.error('Error while trying to get L2 network for Arbitrum client:', e);
    }
  }

  private getERC20ContractForDexL1(chainId: string): Contract {
    return new ethers.Contract(chainId, ERC20_ABI, this.l1Wallet);
  }
}
