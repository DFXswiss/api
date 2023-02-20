import { asL2Provider, estimateTotalGasCost, CrossChainMessenger, MessageStatus } from '@eth-optimism/sdk';
import { BigNumber, ethers } from 'ethers';
import { GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';
import { L2BridgeEvmClient } from '../shared/evm/interfaces';

interface OptimismTransactionReceipt extends ethers.providers.TransactionReceipt {
  l1GasPrice: BigNumber;
  l1GasUsed: BigNumber;
  l1FeeScalar: number;
}

export class OptimismClient extends EvmClient implements L2BridgeEvmClient {
  #l1Provider: ethers.providers.JsonRpcProvider;
  #l1Wallet: ethers.Wallet;

  #crossChainMessenger: CrossChainMessenger;

  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    privateKey: string,
    dfxAddress: string,
    swapContractAddress: string,
    swapTokenAddress: string,
  ) {
    super(http, scanApiUrl, scanApiKey, gatewayUrl, privateKey, dfxAddress, swapContractAddress, swapTokenAddress);

    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethChainId } = GetConfig().blockchain.ethereum;
    const { optimismChainId } = GetConfig().blockchain.optimism;
    const ethereumGateway = `${ethGatewayUrl}/${ethApiKey ?? ''}`;

    this.#l1Provider = new ethers.providers.JsonRpcProvider(ethereumGateway);
    this.#l1Wallet = new ethers.Wallet(ethWalletPrivateKey, this.provider);

    this.#crossChainMessenger = new CrossChainMessenger({
      l1ChainId: ethChainId,
      l2ChainId: optimismChainId,
      l1SignerOrProvider: this.#l1Wallet,
      l2SignerOrProvider: this.wallet,
    });
  }

  async depositCoinOnDex(amount: number): Promise<string> {
    const response = await this.#crossChainMessenger.depositETH(this.convertToWeiLikeDenomination(amount, 'ether'));

    return response.hash;
  }

  async withdrawCoinOnDex(amount: number): Promise<string> {
    const response = await this.#crossChainMessenger.withdrawETH(this.convertToWeiLikeDenomination(amount, 'ether'));

    return response.hash;
  }

  async depositTokenOnDex(l1Token: Asset, amount: number): Promise<string> {
    const contract = this.getERC20ContractForDex(l1Token.chainId);
    const decimals = await contract.decimals();

    const allowanceResponse = await this.#crossChainMessenger.approveERC20(
      l1Token.chainId,
      l1Token.chainId,
      this.convertToWeiLikeDenomination(amount, decimals),
    );

    await allowanceResponse.wait();

    const response = await this.#crossChainMessenger.depositERC20(
      l1Token.chainId,
      l1Token.chainId,
      this.convertToWeiLikeDenomination(amount, decimals),
    );

    return response.hash;
  }

  async withdrawTokenOnDex(l1Token: Asset, amount: number): Promise<string> {
    const contract = this.getERC20ContractForDex(l1Token.chainId);
    const decimals = await contract.decimals();

    const response = await this.#crossChainMessenger.withdrawERC20(
      l1Token.chainId,
      l1Token.chainId,
      this.convertToWeiLikeDenomination(amount, decimals),
    );

    return response.hash;
  }

  async checkL2BridgeCompletion(l1TxId: string): Promise<boolean> {
    try {
      const status = await this.#crossChainMessenger.getMessageStatus(l1TxId);

      return status === MessageStatus.RELAYED;
    } catch {
      return false;
    }
  }

  async checkL1BridgeCompletion(l2TxId: string): Promise<boolean> {
    const status = await this.#crossChainMessenger.getMessageStatus(l2TxId);

    switch (status) {
      case MessageStatus.READY_TO_PROVE: {
        await this.#crossChainMessenger.proveMessage(l2TxId);

        return false;
      }

      case MessageStatus.READY_FOR_RELAY: {
        await this.#crossChainMessenger.finalizeMessage(l2TxId);

        return false;
      }

      case MessageStatus.RELAYED: {
        return true;
      }

      default:
        return false;
    }
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    const totalGasCost = await estimateTotalGasCost(asL2Provider(this.provider), {
      from: this.dfxAddress,
      to: this.randomReceiverAddress,
      value: 1,
    });

    return this.convertToEthLikeDenomination(totalGasCost);
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    const totalGasCost = await estimateTotalGasCost(asL2Provider(this.provider), {
      from: this.dfxAddress,
      to: token.chainId,
      data: this.dummyTokenPayload,
    });

    return this.convertToEthLikeDenomination(totalGasCost);
  }

  /**
   * @overwrite
   */
  async getTxActualFee(txHash: string): Promise<number> {
    const { gasUsed, effectiveGasPrice, l1GasPrice, l1GasUsed, l1FeeScalar } = (await asL2Provider(
      this.provider,
    ).getTransactionReceipt(txHash)) as OptimismTransactionReceipt;

    const actualL2Fee = gasUsed.mul(effectiveGasPrice);
    const actualL1Fee = l1GasUsed.mul(l1GasPrice).mul(l1FeeScalar);

    return this.convertToEthLikeDenomination(actualL2Fee.add(actualL1Fee));
  }

  /**
   * @note
   * requires UniswapV3 implementation or alternative
   */
  async nativeCryptoTestSwap(_nativeCryptoAmount: number, _targetToken: Asset): Promise<number> {
    throw new Error('nativeCryptoTestSwap is not implemented for Optimism blockchain');
  }
}
