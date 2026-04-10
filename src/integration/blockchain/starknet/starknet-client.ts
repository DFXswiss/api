import { Account, Contract, RpcProvider, CallData, type Abi } from 'starknet';
import { GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { BlockchainSignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { BlockchainClient } from '../shared/util/blockchain-client';
import { StarknetTransactionDto } from './dto/starknet.dto';
import { StarknetUtil } from './starknet.util';

const ERC20_ABI: Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'felt' }],
    outputs: [{ name: 'balance', type: 'Uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'recipient', type: 'felt' },
      { name: 'amount', type: 'Uint256' },
    ],
    outputs: [{ name: 'success', type: 'felt' }],
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'felt' }],
    stateMutability: 'view',
  },
];

// Well-known contract addresses on Starknet mainnet
const ETH_TOKEN_ADDRESS = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

export class StarknetClient extends BlockchainClient {
  private readonly provider: RpcProvider;
  private readonly account: Account;
  private readonly address: string;

  constructor(private readonly http: HttpService) {
    super();

    const { gatewayUrl, walletAddress, walletPrivateKey } = GetConfig().blockchain.starknet;

    this.provider = new RpcProvider({ nodeUrl: gatewayUrl });
    this.address = walletAddress;
    this.account = new Account({ provider: this.provider, address: walletAddress, signer: walletPrivateKey });
  }

  get walletAddress(): string {
    return this.address;
  }

  async getBlockHeight(): Promise<number> {
    const block = await this.provider.getBlockLatestAccepted();
    return block.block_number;
  }

  // --- Balance Methods --- //

  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceForAddress(this.walletAddress);
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.getErc20Balance(STRK_TOKEN_ADDRESS, address, StarknetUtil.strkDecimals);
  }

  async getEthBalance(address?: string): Promise<number> {
    return this.getErc20Balance(ETH_TOKEN_ADDRESS, address ?? this.walletAddress, StarknetUtil.ethDecimals);
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    const owner = address ?? this.walletAddress;
    const contractAddress = asset.chainId;
    if (!contractAddress) return 0;

    return this.getErc20Balance(contractAddress, owner, asset.decimals);
  }

  async getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]> {
    const owner = address ?? this.walletAddress;
    const balances: BlockchainTokenBalance[] = [];

    for (const asset of assets) {
      const contractAddress = asset.chainId;
      if (!contractAddress) continue;

      const balance = await this.getErc20Balance(contractAddress, owner, asset.decimals);
      balances.push({ owner, contractAddress, balance });
    }

    return balances;
  }

  private async getErc20Balance(contractAddress: string, owner: string, decimals: number): Promise<number> {
    const contract = new Contract({ abi: ERC20_ABI, address: contractAddress, providerOrAccount: this.provider });
    const result = await contract.call('balanceOf', [owner]);
    return StarknetUtil.fromWeiAmount(result.toString(), decimals);
  }

  // --- Transaction Methods --- //

  async isTxComplete(txHash: string, confirmations = 0): Promise<boolean> {
    const receipt = await this.provider.getTransactionReceipt(txHash);

    if (receipt.statusReceipt === 'REVERTED' || receipt.statusReceipt === 'ERROR') {
      throw new Error(`Transaction ${txHash} has failed: ${receipt.statusReceipt}`);
    }

    if (receipt.statusReceipt !== 'SUCCEEDED') return false;

    if (confirmations === 0) return true;

    const successReceipt = receipt as any;
    const txBlock = successReceipt.block_number;
    if (!txBlock) return false;

    const currentBlock = await this.getBlockHeight();
    return currentBlock - txBlock >= confirmations;
  }

  async sendSignedTransaction(tx: string): Promise<BlockchainSignedTransactionResponse> {
    try {
      const parsedTx = JSON.parse(tx);
      const result = await this.provider.invokeFunction(parsedTx, parsedTx.details);
      return { hash: result.transaction_hash };
    } catch (e) {
      return { error: { message: e.message } };
    }
  }

  // --- Send Methods --- //

  async sendNativeCoin(toAddress: string, amount: number): Promise<string> {
    return this.sendErc20(STRK_TOKEN_ADDRESS, toAddress, amount, StarknetUtil.strkDecimals);
  }

  async sendEth(toAddress: string, amount: number): Promise<string> {
    return this.sendErc20(ETH_TOKEN_ADDRESS, toAddress, amount, StarknetUtil.ethDecimals);
  }

  async sendToken(toAddress: string, asset: Asset, amount: number): Promise<string> {
    const contractAddress = asset.chainId;
    if (!contractAddress) throw new Error(`No contract address for token ${asset.uniqueName}`);

    const decimals = asset.decimals;
    if (!decimals) throw new Error(`No decimals for token ${asset.uniqueName}`);

    return this.sendErc20(contractAddress, toAddress, amount, decimals);
  }

  private async sendErc20(
    contractAddress: string,
    toAddress: string,
    amount: number,
    decimals: number,
  ): Promise<string> {
    const weiAmount = StarknetUtil.toWeiAmount(amount, decimals);

    const result = await this.account.execute({
      contractAddress,
      entrypoint: 'transfer',
      calldata: CallData.compile({ recipient: toAddress, amount: { low: weiAmount, high: 0n } }),
    });

    return result.transaction_hash;
  }

  // --- Query Methods --- //

  async getTransaction(txHash: string): Promise<StarknetTransactionDto> {
    const tx = await this.provider.getTransactionByHash(txHash);
    const receipt = await this.provider.getTransactionReceipt(txHash);

    const successReceipt = receipt as any;
    const fee = successReceipt.actual_fee
      ? StarknetUtil.fromWeiAmount(successReceipt.actual_fee.amount, StarknetUtil.ethDecimals)
      : 0;

    return {
      blockNumber: successReceipt.block_number ?? 0,
      blockTimestamp: 0,
      txHash: tx.transaction_hash,
      from: (tx as any).sender_address ?? '',
      fee,
      destinations: [],
      status: receipt.statusReceipt,
    };
  }

  async getTxActualFee(txHash: string): Promise<number> {
    const receipt = await this.provider.getTransactionReceipt(txHash);
    const successReceipt = receipt as any;
    return successReceipt.actual_fee
      ? StarknetUtil.fromWeiAmount(successReceipt.actual_fee.amount, StarknetUtil.ethDecimals)
      : 0;
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const estimateFee = await this.account.estimateInvokeFee({
      contractAddress: STRK_TOKEN_ADDRESS,
      entrypoint: 'transfer',
      calldata: CallData.compile({ recipient: this.walletAddress, amount: { low: 1n, high: 0n } }),
    });

    const fee = StarknetUtil.fromWeiAmount(estimateFee.overall_fee.toString(), StarknetUtil.ethDecimals);
    return fee * 1.2;
  }
}
