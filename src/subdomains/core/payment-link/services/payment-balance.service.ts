import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BlockchainTokenBalance } from 'src/integration/blockchain/shared/dto/blockchain-token-balance.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { SolanaClient } from 'src/integration/blockchain/solana/solana-client';
import { SolanaUtil } from 'src/integration/blockchain/solana/solana.util';
import { TronClient } from 'src/integration/blockchain/tron/tron-client';
import { TronUtil } from 'src/integration/blockchain/tron/tron.util';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';

@Injectable()
export class PaymentBalanceService implements OnModuleInit {
  private readonly logger = new DfxLogger(PaymentBalanceService);

  private readonly chainsWithoutPaymentBalance = [
    Blockchain.LIGHTNING,
    Blockchain.MONERO,
    Blockchain.ZANO,
    Blockchain.BINANCE_PAY,
    Blockchain.KUCOIN_PAY,
  ];

  private evmDepositAddress: string;
  private solanaDepositAddress: string;
  private tronDepositAddress: string;
  private moneroDepositAddress: string;
  private bitcoinDepositAddress: string;
  private zanoDepositAddress: string;

  constructor(
    private readonly assetService: AssetService,
    private readonly blockchainRegistryService: BlockchainRegistryService,
  ) {}

  onModuleInit() {
    this.evmDepositAddress = EvmUtil.createWallet({ seed: Config.payment.evmSeed, index: 0 }).address;
    this.solanaDepositAddress = SolanaUtil.createWallet({ seed: Config.payment.solanaSeed, index: 0 }).address;
    this.tronDepositAddress = TronUtil.createWallet({ seed: Config.payment.tronSeed, index: 0 }).address;

    this.moneroDepositAddress = Config.payment.moneroAddress;
    this.bitcoinDepositAddress = Config.payment.bitcoinAddress;
    this.zanoDepositAddress = Config.payment.zanoAddress;
  }

  async getPaymentBalances(assets: Asset[]): Promise<Map<number, BlockchainTokenBalance>> {
    const paymentAssets = assets.filter(
      (a) => a.paymentEnabled && !this.chainsWithoutPaymentBalance.includes(a.blockchain),
    );

    const groupedAssets = Array.from(Util.groupBy<Asset, Blockchain>(paymentAssets, 'blockchain').entries());

    const balanceMap = new Map<number, BlockchainTokenBalance>();

    await Promise.all(
      groupedAssets.map(async ([chain, assets]) => {
        const client = this.blockchainRegistryService.getClient(chain);

        const targetAddress = this.getDepositAddress(chain);

        const coin = assets.find((a) => a.type === AssetType.COIN);
        const tokens = assets.filter((a) => a.type !== AssetType.COIN);

        balanceMap.set(coin.id, {
          owner: targetAddress,
          contractAddress: coin.chainId,
          balance: await client.getNativeCoinBalanceForAddress(targetAddress),
        });

        if (tokens.length) {
          const tokenBalances = await client.getTokenBalances(tokens, targetAddress);
          for (const token of tokens) {
            const balance = tokenBalances.find((b) => b.contractAddress === token.chainId)?.balance;

            balance &&
              balanceMap.set(token.id, {
                owner: targetAddress,
                contractAddress: token.chainId,
                balance,
              });
          }
        }
      }),
    );

    return balanceMap;
  }

  getDepositAddress(method: Blockchain): string | undefined {
    switch (method) {
      case Blockchain.ETHEREUM:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.BASE:
      case Blockchain.GNOSIS:
      case Blockchain.POLYGON:
      case Blockchain.BINANCE_SMART_CHAIN:
        return this.evmDepositAddress;

      case Blockchain.BITCOIN:
        return this.bitcoinDepositAddress;

      case Blockchain.MONERO:
        return this.moneroDepositAddress;

      case Blockchain.ZANO:
        return this.zanoDepositAddress;

      case Blockchain.SOLANA:
        return this.solanaDepositAddress;

      case Blockchain.TRON:
        return this.tronDepositAddress;
    }
  }

  async forwardDeposits() {
    const chainsWithoutForwarding = [Blockchain.BITCOIN, ...this.chainsWithoutPaymentBalance];

    const paymentAssets = await this.assetService
      .getPaymentAssets()
      .then((l) => l.filter((a) => !chainsWithoutForwarding.includes(a.blockchain)));

    const balances = await this.getPaymentBalances(paymentAssets);

    for (const asset of paymentAssets) {
      const balance = balances.get(asset.id)?.balance;
      const balanceChf = balance * asset.approxPriceChf || 0;

      if (balanceChf >= Config.payment.maxDepositBalance) {
        const tx = await this.forwardDeposit(asset, balance);
        this.logger.info(`Forwarded ${balance} ${asset.uniqueName} to liquidity address: ${tx}`);
      }
    }
  }

  private async forwardDeposit(asset: Asset, balance: number): Promise<string> {
    const account = this.getPaymentAccount(asset.blockchain);
    const client = this.blockchainRegistryService.getClient(asset.blockchain) as EvmClient | SolanaClient | TronClient;

    return asset.type === AssetType.COIN
      ? client.sendNativeCoinFromAccount(account, client.walletAddress, balance)
      : client.sendTokenFromAccount(account, client.walletAddress, asset, balance);
  }

  private getPaymentAccount(chain: Blockchain): WalletAccount {
    switch (chain) {
      case Blockchain.ETHEREUM:
      case Blockchain.BINANCE_SMART_CHAIN:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.POLYGON:
      case Blockchain.BASE:
      case Blockchain.GNOSIS:
        return { seed: Config.payment.evmSeed, index: 0 };

      case Blockchain.SOLANA:
        return { seed: Config.payment.solanaSeed, index: 0 };

      case Blockchain.TRON:
        return { seed: Config.payment.tronSeed, index: 0 };
    }

    throw new Error(`Payment forwarding not implemented for ${chain}`);
  }
}
