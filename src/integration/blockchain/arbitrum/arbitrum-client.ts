import { BigNumber, Contract, ethers } from 'ethers';
import {
  getL2Network,
  EthBridger,
  L2Network,
  Erc20Bridger,
  L2TransactionReceipt,
  L2ToL1MessageStatus,
} from '@arbitrum/sdk';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';
import { GetConfig } from 'src/config/config';
import { EthDepositParams } from '@arbitrum/sdk/dist/lib/assetBridger/ethBridger';
import { L2BridgeEvmClient } from '../shared/evm/interfaces';
import { Util } from 'src/shared/utils/util';
import {
  L1ContractCallTransactionReceipt,
  L1EthDepositTransactionReceipt,
} from '@arbitrum/sdk/dist/lib/message/L1Transaction';
import ERC20_ABI from '../shared/evm/abi/erc20.abi.json';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ChainId } from '@uniswap/smart-order-router';

export class ArbitrumClient extends EvmClient implements L2BridgeEvmClient {
  private readonly logger = new DfxLogger(ArbitrumClient);

  #l1Provider: ethers.providers.JsonRpcProvider;
  #l1Wallet: ethers.Wallet;
  #l2Network: L2Network;

  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    privateKey: string,
    chainId: ChainId,
  ) {
    super(http, scanApiUrl, scanApiKey, chainId, gatewayUrl, privateKey);

    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey } = GetConfig().blockchain.ethereum;
    const ethereumGateway = `${ethGatewayUrl}/${ethApiKey ?? ''}`;

    this.#l1Provider = new ethers.providers.JsonRpcProvider(ethereumGateway);
    this.#l1Wallet = new ethers.Wallet(ethWalletPrivateKey, this.#l1Provider);

    void this.initL2Network();
  }

  async depositCoinOnDex(amount: number): Promise<string> {
    const ethBridger = new EthBridger(this.#l2Network);

    const depositTx = await ethBridger.deposit({
      amount: this.convertToWeiLikeDenomination(amount, 'ether'),
      l1Signer: this.#l1Wallet,
      l2Provider: this.provider,
    } as EthDepositParams);

    return depositTx.hash;
  }

  async withdrawCoinOnDex(amount: number): Promise<string> {
    const ethBridger = new EthBridger(this.#l2Network);

    const withdrawTx = await ethBridger.withdraw({
      amount: this.convertToWeiLikeDenomination(amount, 'ether'),
      l2Signer: this.wallet,
      from: this.wallet.address,
      destinationAddress: this.#l1Wallet.address,
    });

    return withdrawTx.hash;
  }

  async approveToken(l1Token: Asset, _l2Token: Asset): Promise<string> {
    const erc20Bridge = new Erc20Bridger(this.#l2Network);

    const approveTx = await erc20Bridge.approveToken({
      l1Signer: this.#l1Wallet,
      erc20L1Address: l1Token.chainId,
    });

    return approveTx.hash;
  }

  async depositTokenOnDex(l1Token: Asset, _l2Token: Asset, amount: number): Promise<string> {
    const erc20Bridge = new Erc20Bridger(this.#l2Network);
    const contract = this.getERC20ContractForDexL1(l1Token.chainId);
    const decimals = await contract.decimals();

    const depositTx = await erc20Bridge.deposit({
      amount: this.convertToWeiLikeDenomination(amount, decimals),
      erc20L1Address: l1Token.chainId,
      l1Signer: this.#l1Wallet,
      l2Provider: this.provider,
    });

    return depositTx.hash;
  }

  async withdrawTokenOnDex(l1Token: Asset, _l2Token: Asset, amount: number): Promise<string> {
    const erc20Bridge = new Erc20Bridger(this.#l2Network);
    const contract = this.getERC20ContractForDexL1(l1Token.chainId);
    const decimals = await contract.decimals();

    const approveTx = await erc20Bridge.approveToken({
      amount: this.convertToWeiLikeDenomination(amount, decimals),
      l1Signer: this.#l1Wallet,
      erc20L1Address: l1Token.chainId,
    });

    await approveTx.wait();

    const withdrawTx = await erc20Bridge.withdraw({
      amount: this.convertToWeiLikeDenomination(amount, decimals),
      destinationAddress: this.#l1Wallet.address,
      erc20l1Address: l1Token.chainId,
      l2Signer: this.wallet,
    });

    return withdrawTx.hash;
  }

  async checkL2BridgeCompletion(l1TxId: string, asset: Asset): Promise<boolean> {
    try {
      const txReceipt = await Util.timeout(this.#l1Provider.getTransactionReceipt(l1TxId), 10000);
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
      const l2ToL1Messages = await Util.timeout(l2TxReceipt.getL2ToL1Messages(this.#l1Wallet), 10000);

      const status = await l2ToL1Messages[0].status(this.provider);

      if (status === L2ToL1MessageStatus.CONFIRMED) {
        await l2ToL1Messages[0].execute(this.provider);
      }

      return status === L2ToL1MessageStatus.EXECUTED;
    } catch {
      return false;
    }
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const totalGas = await this.getCurrentGasForCoinTransaction(1e-18);
    const gasPrice = await this.getCurrentGasPrice();

    return this.convertToEthLikeDenomination(totalGas.mul(gasPrice));
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    const totalGas = await this.provider.estimateGas({
      from: this.dfxAddress,
      to: token.chainId,
      data: this.dummyTokenPayload,
    });

    const gasPrice = await this.getCurrentGasPrice();

    return this.convertToEthLikeDenomination(totalGas.mul(gasPrice));
  }

  //*** HELPER METHODS ***//

  protected async sendNativeCoin(
    wallet: ethers.Wallet,
    toAddress: string,
    amount: number,
    feeLimit?: number,
  ): Promise<string> {
    const fromAddress = wallet.address;
    const gasLimit = await this.getCurrentGasForCoinTransaction(amount);
    const gasPrice = await this.getGasPrice(+gasLimit, feeLimit);
    const nonce = await this.getNonce(fromAddress);

    const tx = await wallet.sendTransaction({
      from: fromAddress,
      to: toAddress,
      value: this.convertToWeiLikeDenomination(amount, 'ether'),
      nonce,
      gasPrice,
      gasLimit,
    });

    this.nonce.set(fromAddress, nonce + 1);

    return tx.hash;
  }

  /**
   * @TODO
   * consider using this as a primary source of estimating gas in super class
   */
  private async getCurrentGasForCoinTransaction(amount: number): Promise<BigNumber> {
    return this.provider.estimateGas({
      from: this.dfxAddress,
      to: this.randomReceiverAddress,
      value: this.convertToWeiLikeDenomination(amount, 'ether'),
    });
  }

  private async initL2Network() {
    try {
      this.#l2Network = await getL2Network(this.provider);
    } catch (e) {
      this.logger.error('Error while trying to get L2 network for Arbitrum client', e);
    }
  }

  private getERC20ContractForDexL1(chainId: string): Contract {
    return new ethers.Contract(chainId, ERC20_ABI, this.#l1Wallet);
  }
}
