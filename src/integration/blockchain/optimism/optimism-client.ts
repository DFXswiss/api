import { CrossChainMessenger, MessageStatus } from '@eth-optimism/sdk';
import { ethers } from 'ethers';
import { GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { EvmClientParams } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { L2BridgeEvmClient } from '../shared/evm/interfaces';
import { OpStackEvmClient } from '../shared/evm/op-stack-evm-client';

export class OptimismClient extends OpStackEvmClient implements L2BridgeEvmClient {
  protected override readonly logger = new DfxLogger(OptimismClient);

  private readonly l1Provider: ethers.providers.JsonRpcProvider;
  private readonly l1Wallet: ethers.Wallet;

  private readonly crossChainMessenger: CrossChainMessenger;

  constructor(params: EvmClientParams) {
    super(params);

    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethChainId } = GetConfig().blockchain.ethereum;
    const { optimismChainId } = GetConfig().blockchain.optimism;
    const ethereumGateway = `${ethGatewayUrl}/${ethApiKey ?? ''}`;

    this.l1Provider = new ethers.providers.JsonRpcProvider(ethereumGateway);
    this.l1Wallet = new ethers.Wallet(ethWalletPrivateKey, this.l1Provider);

    this.crossChainMessenger = new CrossChainMessenger({
      l1ChainId: ethChainId,
      l2ChainId: optimismChainId,
      l1SignerOrProvider: this.l1Wallet,
      l2SignerOrProvider: this.wallet,
      bedrock: true,
    });
  }

  async depositCoinOnDex(amount: number): Promise<string> {
    const response = await this.crossChainMessenger.depositETH(EvmUtil.toWeiAmount(amount));

    return response.hash;
  }

  async withdrawCoinOnDex(amount: number): Promise<string> {
    const response = await this.crossChainMessenger.withdrawETH(EvmUtil.toWeiAmount(amount));

    return response.hash;
  }

  async approveBridge(l1Token: Asset, l2Token: Asset): Promise<string> {
    const allowanceResponse = await this.crossChainMessenger.approveERC20(
      l1Token.chainId,
      l2Token.chainId,
      ethers.constants.MaxUint256,
    );

    return allowanceResponse.hash;
  }

  async depositTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string> {
    if (l1Token.decimals !== l2Token.decimals) {
      throw new Error(
        `Cannot bridge/deposit Optimism tokens with different decimals. L1 Token: ${l1Token.uniqueName} has ${l1Token.decimals}, L2 Token: ${l2Token.uniqueName} has ${l2Token.decimals}`,
      );
    }

    const response = await this.crossChainMessenger.depositERC20(
      l1Token.chainId,
      l2Token.chainId,
      EvmUtil.toWeiAmount(amount, l1Token.decimals),
    );

    return response.hash;
  }

  async withdrawTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string> {
    if (l1Token.decimals !== l2Token.decimals) {
      throw new Error(
        `Cannot bridge/withdraw Optimism tokens with different decimals. L1 Token: ${l1Token.uniqueName} has ${l1Token.decimals}, L2 Token: ${l2Token.uniqueName} has ${l2Token.decimals}`,
      );
    }

    const response = await this.crossChainMessenger.withdrawERC20(
      l1Token.chainId,
      l2Token.chainId,
      EvmUtil.toWeiAmount(amount, l1Token.decimals),
    );

    return response.hash;
  }

  async checkL2BridgeCompletion(l1TxId: string): Promise<boolean> {
    try {
      const status = await Util.timeout(this.crossChainMessenger.getMessageStatus(l1TxId), 20000);

      return status === MessageStatus.RELAYED;
    } catch {
      return false;
    }
  }

  async checkL1BridgeCompletion(l2TxId: string): Promise<boolean> {
    try {
      const status = await Util.timeout(this.crossChainMessenger.getMessageStatus(l2TxId), 20000);

      switch (status) {
        case MessageStatus.READY_TO_PROVE: {
          this.logger.verbose(
            `Checking L1 Bridge transaction completion, L2 txId: ${l2TxId}, status: READY_TO_PROVE, running #proveMessage(...)`,
          );
          await this.crossChainMessenger.proveMessage(l2TxId);

          return false;
        }

        case MessageStatus.READY_FOR_RELAY: {
          this.logger.verbose(
            `Checking L1 Bridge transaction completion, L2 txId: ${l2TxId}, status: READY_FOR_RELAY, running #finalizeMessage(...)`,
          );
          await this.crossChainMessenger.finalizeMessage(l2TxId);

          return false;
        }

        case MessageStatus.RELAYED: {
          return true;
        }

        default:
          return false;
      }
    } catch {
      return false;
    }
  }
}
