import { CrossChainMessenger, L2Provider, MessageStatus, asL2Provider, estimateTotalGasCost } from '@eth-optimism/sdk';
import { BigNumber, ethers } from 'ethers';
import { GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { L2BridgeEvmClient } from '../shared/evm/interfaces';

interface BaseTransactionReceipt extends ethers.providers.TransactionReceipt {
  l1Fee: BigNumber;
  l1GasPrice: BigNumber;
  l1GasUsed: BigNumber;
  l1FeeScalar: number;
}

export class BaseClient extends EvmClient implements L2BridgeEvmClient {
  private readonly logger = new DfxLogger(BaseClient);

  private readonly l1Provider: ethers.providers.JsonRpcProvider;
  private readonly l1Wallet: ethers.Wallet;

  private readonly crossChainMessenger: CrossChainMessenger;

  constructor(params: EvmClientParams) {
    super(params);

    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethChainId } = GetConfig().blockchain.ethereum;
    const { baseChainId } = GetConfig().blockchain.base;
    const ethereumGateway = `${ethGatewayUrl}/${ethApiKey ?? ''}`;

    this.l1Provider = new ethers.providers.JsonRpcProvider(ethereumGateway);
    this.l1Wallet = new ethers.Wallet(ethWalletPrivateKey, this.l1Provider);

    this.crossChainMessenger = new CrossChainMessenger({
      l1ChainId: ethChainId,
      l2ChainId: baseChainId,
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
        `Cannot bridge/deposit Base tokens with different decimals. L1 Token: ${l1Token.uniqueName} has ${l1Token.decimals}, L2 Token: ${l2Token.uniqueName} has ${l2Token.decimals}`,
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
        `Cannot bridge/withdraw Base tokens with different decimals. L1 Token: ${l1Token.uniqueName} has ${l1Token.decimals}, L2 Token: ${l2Token.uniqueName} has ${l2Token.decimals}`,
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
    } catch (e) {
      return false;
    }
  }

  /**
   * @overwrite
   */

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const totalGasCost = await estimateTotalGasCost(this.l2Provider, {
      from: this.walletAddress,
      to: this.randomReceiverAddress,
      value: 1,
      type: 2,
    });

    return EvmUtil.fromWeiAmount(totalGasCost);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    const totalGasCost = await estimateTotalGasCost(this.l2Provider, {
      from: this.walletAddress,
      to: token.chainId,
      data: this.dummyTokenPayload,
      type: 2,
    });

    return EvmUtil.fromWeiAmount(totalGasCost);
  }

  async getTxActualFee(txHash: string): Promise<number> {
    const receipt = await this.l2Provider.getTransactionReceipt(txHash);

    const { gasUsed, effectiveGasPrice, l1Fee } = receipt as BaseTransactionReceipt;

    const l2Fee = gasUsed.mul(effectiveGasPrice);

    return EvmUtil.fromWeiAmount(l1Fee.add(l2Fee));
  }

  //*** HELPER METHODS ***//

  private get l2Provider(): L2Provider<ethers.providers.JsonRpcProvider> {
    return asL2Provider(this.provider);
  }

  private get dummyTokenPayload(): string {
    const method = 'a9059cbb000000000000000000000000';
    const destination = this.randomReceiverAddress.slice(2);
    const value = '0000000000000000000000000000000000000000000000000000000000000001';

    return '0x' + method + destination + value;
  }
}
