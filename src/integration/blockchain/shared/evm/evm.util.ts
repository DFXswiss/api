import { FeeAmount } from '@uniswap/v3-sdk';
import BigNumber from 'bignumber.js';
import { BigNumberish, ethers, BigNumber as EthersNumber } from 'ethers';
import { defaultPath } from 'ethers/lib/utils';
import { GetConfig } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from '../enums/blockchain.enum';
import { WalletAccount } from './domain/wallet-account';

enum FeeType {
  Legacy = 0,
  EIP1559 = 2,
}

interface FeeInfo {
  type: FeeType;
  gasLimit: ethers.BigNumber;
  // for legacy tx
  gasPrice?: ethers.BigNumber;
  // for EIP-1559
  maxFeePerGas?: ethers.BigNumber;
  maxPriorityFeePerGas?: ethers.BigNumber;
}

export class EvmUtil {
  private static blockchainConfig = GetConfig().blockchain;

  private static readonly blockchainToChainIdMap = new Map<Blockchain, number>([
    [Blockchain.ETHEREUM, this.blockchainConfig.ethereum.ethChainId],
    [Blockchain.SEPOLIA, this.blockchainConfig.sepolia.sepoliaChainId],
    [Blockchain.ARBITRUM, this.blockchainConfig.arbitrum.arbitrumChainId],
    [Blockchain.OPTIMISM, this.blockchainConfig.optimism.optimismChainId],
    [Blockchain.POLYGON, this.blockchainConfig.polygon.polygonChainId],
    [Blockchain.BASE, this.blockchainConfig.base.baseChainId],
    [Blockchain.GNOSIS, this.blockchainConfig.gnosis.gnosisChainId],
    [Blockchain.BINANCE_SMART_CHAIN, this.blockchainConfig.bsc.bscChainId],
    [Blockchain.CITREA_TESTNET, this.blockchainConfig.citreaTestnet.citreaTestnetChainId],
  ]);

  static getChainId(blockchain: Blockchain): number | undefined {
    return this.blockchainToChainIdMap.get(blockchain);
  }

  static createWallet({ seed, index }: WalletAccount, provider?: ethers.providers.JsonRpcProvider): ethers.Wallet {
    const wallet = ethers.Wallet.fromMnemonic(seed, this.getPathFor(index));
    return provider ? wallet.connect(provider) : wallet;
  }

  private static getPathFor(accountIndex: number): string {
    const components = defaultPath.split('/');
    components[components.length - 1] = accountIndex.toString();
    return components.join('/');
  }

  static fromWeiAmount(amountWeiLike: BigNumberish, decimals?: number): number {
    const amount =
      decimals != null ? ethers.utils.formatUnits(amountWeiLike, decimals) : ethers.utils.formatEther(amountWeiLike);

    return parseFloat(amount);
  }

  static toWeiAmount(amountEthLike: number, decimals?: number): EthersNumber {
    const amount = new BigNumber(amountEthLike).toFixed(decimals ?? 18);

    return decimals ? ethers.utils.parseUnits(amount, decimals) : ethers.utils.parseEther(amount);
  }

  static poolFeeFactor(amount: FeeAmount): number {
    return amount / 1000000;
  }

  static getPaymentRequest(address: string, asset: Asset, amount: number): string | undefined {
    const chainId = this.getChainId(asset.blockchain);
    if (!chainId || asset.decimals == null) return undefined;

    return asset.type === AssetType.COIN
      ? `ethereum:${address}@${chainId}?value=${EvmUtil.toWeiAmount(amount).toString()}`
      : `ethereum:${asset.chainId}@${chainId}/transfer?address=${address}&uint256=${EvmUtil.toWeiAmount(
          amount,
          asset.decimals,
        ).toString()}`;
  }

  static decodeTransactionFees(txHex: string): FeeInfo {
    const tx = ethers.utils.parseTransaction(txHex);

    const feeInfo: FeeInfo = {
      type: tx.type ?? FeeType.Legacy,
      gasLimit: tx.gasLimit,
    };

    if (tx.type === FeeType.EIP1559) {
      feeInfo.maxFeePerGas = tx.maxFeePerGas;
      feeInfo.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
    } else {
      feeInfo.gasPrice = tx.gasPrice;
    }

    return feeInfo;
  }

  static getGasPriceLimitFromHex(txHex: string, gasPrice: EthersNumber): number {
    const feeInfo = EvmUtil.decodeTransactionFees(txHex);

    return feeInfo.type === FeeType.EIP1559
      ? Math.min(+feeInfo.maxFeePerGas, +gasPrice.add(feeInfo.maxPriorityFeePerGas))
      : +feeInfo.gasPrice;
  }
}
