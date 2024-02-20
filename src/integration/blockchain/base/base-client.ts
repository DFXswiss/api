import { CrossChainMessenger, L2Provider, MessageStatus, asL2Provider, estimateTotalGasCost } from '@eth-optimism/sdk';
import { BigNumber, Contract, ethers } from 'ethers';
import { GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import ERC20_ABI from '../shared/evm/abi/erc20.abi.json';
import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';
import { L2BridgeEvmClient } from '../shared/evm/interfaces';

interface BaseTransactionReceipt extends ethers.providers.TransactionReceipt {
  l1GasPrice: BigNumber;
  l1GasUsed: BigNumber;
  l1FeeScalar: number;
}

export class BaseClient extends EvmClient implements L2BridgeEvmClient {
  private readonly logger = new DfxLogger(BaseClient);

  private l1Provider: ethers.providers.JsonRpcProvider;
  private l1Wallet: ethers.Wallet;

  private crossChainMessenger: CrossChainMessenger;

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
    const response = await this.crossChainMessenger.depositETH(this.toWeiAmount(amount));

    return response.hash;
  }

  async withdrawCoinOnDex(amount: number): Promise<string> {
    const response = await this.crossChainMessenger.withdrawETH(this.toWeiAmount(amount));

    return response.hash;
  }

  async approveToken(l1Token: Asset, l2Token: Asset): Promise<string> {
    const allowanceResponse = await this.crossChainMessenger.approveERC20(l1Token.chainId, l2Token.chainId, Infinity);

    return allowanceResponse.hash;
  }

  async depositTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string> {
    const l1Contract = this.getERC20ContractForDexL1(l1Token.chainId);
    const l2Contract = this.getERC20ContractForDex(l2Token.chainId);

    const l1Decimals = await l1Contract.decimals();
    const l2Decimals = await l2Contract.decimals();

    if (l1Decimals !== l2Decimals) {
      throw new Error(
        `Cannot bridge/deposit Base tokens with different decimals. L1 Token: ${l1Token.uniqueName} has ${l1Decimals}, L2 Token: ${l2Token.uniqueName} has ${l2Decimals}`,
      );
    }

    const response = await this.crossChainMessenger.depositERC20(
      l1Token.chainId,
      l2Token.chainId,
      this.toWeiAmount(amount, l1Decimals),
    );

    return response.hash;
  }

  async withdrawTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string> {
    const l1Contract = this.getERC20ContractForDexL1(l1Token.chainId);
    const l2Contract = this.getERC20ContractForDex(l2Token.chainId);

    const l1Decimals = await l1Contract.decimals();
    const l2Decimals = await l2Contract.decimals();

    if (l1Decimals !== l2Decimals) {
      throw new Error(
        `Cannot bridge/withdraw Base tokens with different decimals. L1 Token: ${l1Token.uniqueName} has ${l1Decimals}, L2 Token: ${l2Token.uniqueName} has ${l2Decimals}`,
      );
    }

    const response = await this.crossChainMessenger.withdrawERC20(
      l1Token.chainId,
      l2Token.chainId,
      this.toWeiAmount(amount, l1Decimals),
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
      from: this.dfxAddress,
      to: this.randomReceiverAddress,
      value: 1,
    });

    return this.fromWeiAmount(totalGasCost);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    const totalGasCost = await estimateTotalGasCost(this.l2Provider, {
      from: this.dfxAddress,
      to: token.chainId,
      data: this.dummyTokenPayload,
    });

    return this.fromWeiAmount(totalGasCost);
  }

  async getTxActualFee(txHash: string): Promise<number> {
    const gasPrice = await this.provider.getGasPrice();

    const receipt = await this.l2Provider.getTransactionReceipt(txHash);

    const { gasUsed, l1GasPrice, l1GasUsed, l1FeeScalar } = receipt as BaseTransactionReceipt;

    const actualL1Fee = this.fromWeiAmount(l1GasUsed.mul(l1GasPrice)) * l1FeeScalar;
    const actualL2Fee = this.fromWeiAmount(gasUsed.mul(gasPrice));

    return actualL1Fee + actualL2Fee;
  }

  //*** HELPER METHODS ***//

  private getERC20ContractForDexL1(chainId: string): Contract {
    return new ethers.Contract(chainId, ERC20_ABI, this.l1Wallet);
  }

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
