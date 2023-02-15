import { BigNumber, Contract, ethers } from 'ethers';
import { getL2Network, EthBridger, L2Network, Erc20Bridger } from '@arbitrum/sdk';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';
import { GetConfig } from 'src/config/config';
import { EthDepositParams } from '@arbitrum/sdk/dist/lib/assetBridger/ethBridger';

export class ArbitrumClient extends EvmClient {
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

  async depositTokenOnDex(l1token: Asset, amount: number): Promise<string> {
    const erc20Bridge = new Erc20Bridger(this.#l2Network);

    // I think this needs to be done only once -> maybe check somehow if approval is needed
    const approveTx = await erc20Bridge.approveToken({
      l1Signer: this.#l1Wallet,
      erc20L1Address: l1token.chainId,
    });

    await approveTx.wait();

    const contract = this.getERC20ContractForDex(l1token.chainId);
    const decimals = await contract.decimals();

    // returns L1 transaction hash?
    const depositTx = await erc20Bridge.deposit({
      amount: this.convertToWeiLikeDenomination(amount, decimals),
      erc20L1Address: l1token.chainId,
      l1Signer: this.#l1Wallet,
      l2Provider: this.provider,
    });

    return depositTx.hash;
  }

  async withdrawTokenOnDex(l1token: Asset, amount: number): Promise<string> {
    const erc20Bridge = new Erc20Bridger(this.#l2Network);

    // I think this needs to be done only once -> maybe check somehow if approval is needed
    const approveTx = await erc20Bridge.approveToken({
      l1Signer: this.#l1Wallet,
      erc20L1Address: l1token.chainId,
    });

    await approveTx.wait();

    const contract = this.getERC20ContractForDex(l1token.chainId);
    const decimals = await contract.decimals();

    // returns L2 transaction hash?
    const withdrawTx = await erc20Bridge.withdraw({
      amount: this.convertToWeiLikeDenomination(amount, decimals),
      destinationAddress: this.wallet.address,
      erc20l1Address: l1token.chainId,
      l2Signer: this.wallet,
    });

    return withdrawTx.hash;
  }

  async checkL2TransactionCompletion(l1TxId: string): Promise<boolean> {}

  async checkL1TransactionCompletion(l2TxId: string): Promise<boolean> {}

  /**
   * @note
   * requires UniswapV3 implementation or alternative
   */
  async nativeCryptoTestSwap(_nativeCryptoAmount: number, _targetToken: Asset): Promise<number> {
    throw new Error('nativeCryptoTestSwap is not implemented for Arbitrum blockchain');
  }

  //*** HELPER METHODS ***//

  private async initL2Network() {
    try {
      this.#l2Network = await getL2Network(this.provider);
    } catch (e) {
      console.error('Error while trying to get L2 network for Arbitrum client', e);
    }
  }
}
