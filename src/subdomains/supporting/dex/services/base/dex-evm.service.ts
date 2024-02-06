import { Contract } from 'ethers';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';

export abstract class DexEvmService {
  #client: EvmClient;

  constructor(
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
    protected readonly service: EvmService,
    protected readonly nativeCoin: string,
    protected readonly blockchain: Blockchain,
  ) {
    this.#client = service.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.#client.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, tokenName: Asset, amount: number): Promise<string> {
    return this.#client.sendTokenFromDex(address, tokenName, amount);
  }

  async checkTransactionCompletion(txHash: string): Promise<boolean> {
    return this.#client.isTxComplete(txHash);
  }

  async checkNativeCoinAvailability(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(this.nativeCoin);
    const availableAmount = await this.#client.getNativeCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  async getAndCheckTokenAvailability(
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
  ): Promise<[number, number]> {
    const targetAmount = await this.getTargetAmount(sourceAsset, sourceAmount, targetAsset);
    const availableAmount = await this.getTokenAvailableAmount(targetAsset);

    return [targetAmount, availableAmount];
  }

  async getDexHistory(): Promise<[EvmCoinHistoryEntry[], EvmTokenHistoryEntry[]]> {
    const address = this.#client.dfxAddress;
    const currentBlock = await this.#client.getCurrentBlock();
    const startBlock = Util.round(currentBlock - 100, 0);
    const allCoinTransactions = await this.#client.getNativeCoinTransactions(address, startBlock);
    const allTokenTransactions = await this.#client.getERC20Transactions(address, startBlock);

    return [allCoinTransactions, allTokenTransactions];
  }

  async getTargetAmount(sourceAsset: Asset, sourceAmount: number, targetAsset: Asset): Promise<number> {
    if (sourceAsset.dexName === targetAsset.dexName) return sourceAmount;

    return this.#client.testSwap(sourceAsset, sourceAmount, targetAsset);
  }

  fromWeiAmount(amountWeiLike: string, decimals?: number): number {
    return this.#client.fromWeiAmount(amountWeiLike, decimals);
  }

  getERC20ContractForDex(tokenAddress: string): Contract {
    return this.#client.getERC20ContractForDex(tokenAddress);
  }

  get _nativeCoin(): string {
    return this.nativeCoin;
  }

  //*** HELPER METHODS ***//

  private async getTokenAvailableAmount(asset: Asset): Promise<number> {
    const pendingAmount = await this.getPendingAmount(asset.dexName);
    const availableAmount = await this.#client.getTokenBalance(asset);

    // adding a small cap to pendingAmount in case testSwap results got slightly outdated by the moment current check is done
    return availableAmount - pendingAmount * 1.05;
  }

  private async getPendingAmount(assetName: string): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.findBy({ isComplete: false })).filter(
      (o) => o.targetAsset.dexName === assetName && o.targetAsset.blockchain === this.blockchain,
    );

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
