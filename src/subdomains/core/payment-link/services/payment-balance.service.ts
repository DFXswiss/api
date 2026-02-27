import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { BitcoinNodeType } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { CardanoUtil } from 'src/integration/blockchain/cardano/cardano.util';
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

  private readonly unavailableWarningsLogged = new Set<Blockchain>();

  private readonly chainsWithoutPaymentBalance = [
    Blockchain.LIGHTNING,
    Blockchain.MONERO,
    Blockchain.ZANO,
    Blockchain.CARDANO,
    Blockchain.BINANCE_PAY,
    Blockchain.KUCOIN_PAY,
  ];

  private evmDepositAddress: string;
  private solanaDepositAddress: string;
  private tronDepositAddress: string;
  private cardanoDepositAddress: string;
  private bitcoinDepositAddress: string;
  private firoDepositAddress: string;
  private moneroDepositAddress: string;
  private zanoDepositAddress: string;

  constructor(
    private readonly assetService: AssetService,
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly bitcoinFeeService: BitcoinFeeService,
  ) {}

  onModuleInit() {
    this.evmDepositAddress = EvmUtil.createWallet({ seed: Config.payment.evmSeed, index: 0 }).address;
    this.solanaDepositAddress = SolanaUtil.createWallet({ seed: Config.payment.solanaSeed, index: 0 }).address;
    this.tronDepositAddress = TronUtil.createWallet({ seed: Config.payment.tronSeed, index: 0 }).address;
    this.cardanoDepositAddress = CardanoUtil.createWallet({ seed: Config.payment.cardanoSeed, index: 0 })?.address;

    this.bitcoinDepositAddress = Config.payment.bitcoinAddress;
    this.firoDepositAddress = Config.payment.firoAddress;
    this.moneroDepositAddress = Config.payment.moneroAddress;
    this.zanoDepositAddress = Config.payment.zanoAddress;
  }

  async getPaymentBalances(assets: Asset[], catchException = false): Promise<Map<number, BlockchainTokenBalance>> {
    const paymentAssets = assets.filter(
      (a) => a.paymentEnabled && !this.chainsWithoutPaymentBalance.includes(a.blockchain),
    );

    const groupedAssets = Array.from(Util.groupBy<Asset, Blockchain>(paymentAssets, 'blockchain').entries());

    const balanceMap = new Map<number, BlockchainTokenBalance>();

    await Promise.all(
      groupedAssets.map(async ([chain, assets]) => {
        const client = this.blockchainRegistryService.getClient(chain);
        if (!client) {
          if (!this.unavailableWarningsLogged.has(chain)) {
            this.logger.warn(`Blockchain client not configured for ${chain} - skipping payment balance`);
            this.unavailableWarningsLogged.add(chain);
          }
          return;
        }

        const targetAddress = this.getDepositAddress(chain);
        if (!targetAddress) return;

        const coin = assets.find((a) => a.type === AssetType.COIN);
        const tokens = assets.filter((a) => a.type !== AssetType.COIN);

        try {
          if (coin) {
            balanceMap.set(coin.id, {
              owner: targetAddress,
              contractAddress: coin.chainId,
              balance: await client.getNativeCoinBalanceForAddress(targetAddress),
            });
          }

          if (tokens.length) {
            const tokenBalances = await client.getTokenBalances(tokens, targetAddress);
            for (const token of tokens) {
              const balance = tokenBalances.find((b) => b.contractAddress === token.chainId)?.balance;

              if (balance)
                balanceMap.set(token.id, {
                  owner: targetAddress,
                  contractAddress: token.chainId,
                  balance,
                });
            }
          }
        } catch (e) {
          if (!catchException) throw e;

          this.logger.error(`Error getting payment balances for blockchain ${chain}:`, e);
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

      case Blockchain.FIRO:
        return this.firoDepositAddress;

      case Blockchain.MONERO:
        return this.moneroDepositAddress;

      case Blockchain.ZANO:
        return this.zanoDepositAddress;

      case Blockchain.SOLANA:
        return this.solanaDepositAddress;

      case Blockchain.TRON:
        return this.tronDepositAddress;

      case Blockchain.CARDANO:
        return this.cardanoDepositAddress;
    }
  }

  async forwardDeposits() {
    const chainsWithoutForwarding = [Blockchain.FIRO, ...this.chainsWithoutPaymentBalance];

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
    if (asset.blockchain === Blockchain.BITCOIN) {
      return this.forwardBitcoinDeposit();
    }

    const account = this.getPaymentAccount(asset.blockchain);
    const client = this.blockchainRegistryService.getClient(asset.blockchain) as EvmClient | SolanaClient | TronClient;

    return asset.type === AssetType.COIN
      ? client.sendNativeCoinFromAccount(account, client.walletAddress, balance)
      : client.sendTokenFromAccount(account, client.walletAddress, asset, balance);
  }

  private async forwardBitcoinDeposit(): Promise<string> {
    const client = this.blockchainRegistryService.getBitcoinClient(Blockchain.BITCOIN, BitcoinNodeType.BTC_INPUT);
    const outputAddress = Config.blockchain.default.btcOutput.address;
    const feeRate = await this.bitcoinFeeService.getSendFeeRate();

    // sweep all payment UTXOs: amount 0 = use full UTXO balance, fee subtracted from output
    return client.sendManyFromAddress(
      [Config.payment.bitcoinAddress],
      [{ addressTo: outputAddress, amount: 0 }],
      feeRate,
      [0],
    );
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
