import { BigNumber, ethers } from 'ethers';
import {
  getL2Network,
  EthBridger,
  L2Network,
  Erc20Bridger,
  L1TransactionReceipt,
  L1ToL2MessageStatus,
  L2TransactionReceipt,
  L2ToL1MessageStatus,
} from '@arbitrum/sdk';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';
import { GetConfig } from 'src/config/config';
import { EthDepositParams } from '@arbitrum/sdk/dist/lib/assetBridger/ethBridger';
import { L2BridgeEvmClient } from '../shared/evm/interfaces';

export class ArbitrumClient extends EvmClient implements L2BridgeEvmClient {
  #l1Provider: ethers.providers.JsonRpcProvider;
  #l1Wallet: ethers.Wallet;
  #l2Network: L2Network;

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

    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey } = GetConfig().blockchain.ethereum;
    const ethereumGateway = `${ethGatewayUrl}/${ethApiKey ?? ''}`;

    this.#l1Provider = new ethers.providers.JsonRpcProvider(ethereumGateway);
    this.#l1Wallet = new ethers.Wallet(ethWalletPrivateKey, this.provider);

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initL2Network();
  }

  async depositCoinOnDex(amount: number): Promise<string> {
    const ethBridger = new EthBridger(this.#l2Network);

    // returns L1 transaction hash?
    const depositTx = await ethBridger.deposit({
      amount: this.convertToWeiLikeDenomination(amount, 'ether'),
      l1Signer: this.#l1Wallet,
      l2Provider: this.provider,
    } as EthDepositParams);

    return depositTx.hash;
  }

  async withdrawCoinOnDex(amount: number): Promise<string> {
    const ethBridger = new EthBridger(this.#l2Network);

    // returns L2 transaction hash?
    const withdrawTx = await ethBridger.withdraw({
      amount: this.convertToWeiLikeDenomination(amount, 'ether'),
      l2Signer: this.wallet,
      from: this.wallet.address,
      destinationAddress: this.#l1Wallet.address,
    });

    return withdrawTx.hash;
  }

  async depositTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string> {
    const erc20Bridge = new Erc20Bridger(this.#l2Network);

    // I think this needs to be done only once -> maybe check somehow if approval is needed
    const approveTx = await erc20Bridge.approveToken({
      l1Signer: this.#l1Wallet,
      erc20L1Address: l1Token.chainId,
    });

    await approveTx.wait();

    const contract = this.getERC20ContractForDex(l1Token.chainId);
    const decimals = await contract.decimals();

    // returns L1 transaction hash?
    const depositTx = await erc20Bridge.deposit({
      amount: this.convertToWeiLikeDenomination(amount, decimals),
      erc20L1Address: l1Token.chainId,
      l1Signer: this.#l1Wallet,
      l2Provider: this.provider,
    });

    return depositTx.hash;
  }

  async withdrawTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string> {
    const erc20Bridge = new Erc20Bridger(this.#l2Network);

    // I think this needs to be done only once -> maybe check somehow if approval is needed
    const approveTx = await erc20Bridge.approveToken({
      l1Signer: this.#l1Wallet,
      erc20L1Address: l1Token.chainId,
    });

    await approveTx.wait();

    const contract = this.getERC20ContractForDex(l1Token.chainId);
    const decimals = await contract.decimals();

    // returns L2 transaction hash?
    const withdrawTx = await erc20Bridge.withdraw({
      amount: this.convertToWeiLikeDenomination(amount, decimals),
      destinationAddress: this.wallet.address,
      erc20l1Address: l1Token.chainId,
      l2Signer: this.wallet,
    });

    return withdrawTx.hash;
  }

  async checkL2BridgeCompletion(l1TxId: string): Promise<boolean> {
    try {
      const l1TxReceipt = new L1TransactionReceipt(await this.#l1Provider.getTransactionReceipt(l1TxId));
      const isCoinTransaction = l1TxReceipt.to === this.wallet.address;
      const l1ToL2Message = (await l1TxReceipt.getL1ToL2Messages(this.wallet))[0];

      const { status } = await l1ToL2Message.waitForStatus(null, 5000);

      return isCoinTransaction
        ? status === L1ToL2MessageStatus.FUNDS_DEPOSITED_ON_L2
        : status === L1ToL2MessageStatus.REDEEMED;
    } catch {
      return false;
    }
  }

  async checkL1BridgeCompletion(l2TxId: string): Promise<boolean> {
    try {
      const l2TxReceipt = new L2TransactionReceipt(await this.provider.getTransactionReceipt(l2TxId));
      const l2ToL1Message = (await l2TxReceipt.getL2ToL1Messages(this.#l1Wallet))[0];

      const status = await l2ToL1Message.status(this.provider);

      return status === L2ToL1MessageStatus.CONFIRMED;
    } catch {
      return false;
    }
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const totalGas = await this.provider.estimateGas({
      from: this.dfxAddress,
      to: this.randomReceiverAddress,
      value: 1,
    });

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

  /**
   * @note
   * requires UniswapV3 implementation or alternative
   */
  async nativeCryptoTestSwap(_nativeCryptoAmount: number, _targetToken: Asset): Promise<number> {
    throw new Error('nativeCryptoTestSwap is not implemented for Arbitrum blockchain');
  }

  //*** HELPER METHODS ***//

  protected async sendNativeCoin(
    wallet: ethers.Wallet,
    fromAddress: string,
    toAddress: string,
    amount: number,
    feeLimit?: number,
  ): Promise<string> {
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
      console.error('Error while trying to get L2 network for Arbitrum client', e);
    }
  }
}
