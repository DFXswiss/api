import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { CoinGeckoService } from '../../pricing/services/integration/coin-gecko.service';
import { FiatCurrency, GetBalancePdfDto } from '../dto/input/get-balance-pdf.dto';

interface BalanceEntry {
  asset: Asset;
  balance: number;
  value: number;
}

// Map blockchain to CoinGecko platform ID (only EVM chains supported)
const COINGECKO_PLATFORMS: Partial<Record<Blockchain, string>> = {
  [Blockchain.ETHEREUM]: 'ethereum',
  [Blockchain.BINANCE_SMART_CHAIN]: 'binance-smart-chain',
  [Blockchain.POLYGON]: 'polygon-pos',
  [Blockchain.ARBITRUM]: 'arbitrum-one',
  [Blockchain.OPTIMISM]: 'optimistic-ethereum',
  [Blockchain.BASE]: 'base',
  [Blockchain.GNOSIS]: 'xdai',
  [Blockchain.HAQQ]: 'haqq-network',
};

// Map native coins to CoinGecko IDs
const NATIVE_COIN_IDS: Partial<Record<Blockchain, string>> = {
  [Blockchain.ETHEREUM]: 'ethereum',
  [Blockchain.BINANCE_SMART_CHAIN]: 'binancecoin',
  [Blockchain.POLYGON]: 'matic-network',
  [Blockchain.ARBITRUM]: 'ethereum',
  [Blockchain.OPTIMISM]: 'ethereum',
  [Blockchain.BASE]: 'ethereum',
  [Blockchain.GNOSIS]: 'xdai',
  [Blockchain.HAQQ]: 'islamic-coin',
  [Blockchain.BITCOIN]: 'bitcoin',
  [Blockchain.LIGHTNING]: 'bitcoin',
  [Blockchain.MONERO]: 'monero',
  [Blockchain.LIQUID]: 'bitcoin',
  [Blockchain.CARDANO]: 'cardano',
  [Blockchain.ARWEAVE]: 'arweave',
  [Blockchain.SOLANA]: 'solana',
  [Blockchain.TRON]: 'tron',
};

@Injectable()
export class BalancePdfService {
  constructor(
    private readonly alchemyService: AlchemyService,
    private readonly assetService: AssetService,
    private readonly coinGeckoService: CoinGeckoService,
  ) {}

  async generateBalancePdf(dto: GetBalancePdfDto): Promise<Buffer> {
    const balances = await this.getBalancesForAddress(dto.address, dto.blockchain, dto.currency, dto.date);
    const totalValue = balances.reduce((sum, b) => sum + b.value, 0);

    return this.createPdf(balances, totalValue, dto);
  }

  private async getBalancesForAddress(
    address: string,
    blockchain: Blockchain,
    currency: FiatCurrency,
    date: Date,
  ): Promise<BalanceEntry[]> {
    const chainId = EvmUtil.getChainId(blockchain);
    const assets = await this.assetService.getAllBlockchainAssets([blockchain]);
    const balances: BalanceEntry[] = [];

    // Find block number for the target date
    const targetTimestamp = Math.floor(date.getTime() / 1000);
    const blockNumber = await this.alchemyService.findBlockByTimestamp(chainId, targetTimestamp);

    // Get native coin balance at historical block
    const nativeCoinBalance = await this.alchemyService.getNativeCoinBalance(chainId, address, blockNumber);
    const nativeCoin = assets.find((a) => !a.chainId);
    if (nativeCoin && nativeCoinBalance) {
      const balance = Number(nativeCoinBalance) / Math.pow(10, 18);
      if (balance > 0) {
        const price = await this.getHistoricalPrice(nativeCoin, blockchain, date, currency);
        balances.push({
          asset: nativeCoin,
          balance,
          value: balance * price,
        });
      }
    }

    // Get token balances at historical block
    const tokenAssets = assets.filter((a) => a.chainId != null);
    for (const asset of tokenAssets) {
      try {
        const rawBalance = await this.alchemyService.getTokenBalanceAtBlock(
          chainId,
          address,
          asset.chainId,
          blockNumber,
        );
        const balance = Number(rawBalance) / Math.pow(10, asset.decimals ?? 18);
        if (balance > 0) {
          const price = await this.getHistoricalPrice(asset, blockchain, date, currency);
          balances.push({
            asset,
            balance,
            value: balance * price,
          });
        }
      } catch (e) {
        // Skip assets that fail to fetch
        continue;
      }
    }

    return balances.sort((a, b) => b.value - a.value);
  }

  private async getHistoricalPrice(
    asset: Asset,
    blockchain: Blockchain,
    date: Date,
    currency: FiatCurrency,
  ): Promise<number> {
    const currencyLower = currency.toLowerCase() as 'usd' | 'eur' | 'chf';
    const platform = COINGECKO_PLATFORMS[blockchain];

    // For native coins, use coin ID
    if (!asset.chainId) {
      const coinId = NATIVE_COIN_IDS[blockchain];
      if (coinId) {
        const price = await this.coinGeckoService.getHistoricalPrice(coinId, date, currencyLower);
        if (price) return price;
      }
    }

    // For tokens, use contract address
    if (asset.chainId && platform) {
      const price = await this.coinGeckoService.getHistoricalPriceByContract(
        platform,
        asset.chainId,
        date,
        currencyLower,
      );
      if (price) return price;
    }

    // Fallback to current price from asset
    return this.getCurrentPriceForCurrency(asset, currency);
  }

  private getCurrentPriceForCurrency(asset: Asset, currency: FiatCurrency): number {
    switch (currency) {
      case FiatCurrency.CHF:
        return asset.approxPriceChf ?? 0;
      case FiatCurrency.EUR:
        return asset.approxPriceEur ?? 0;
      case FiatCurrency.USD:
        return asset.approxPriceUsd ?? 0;
    }
  }

  private createPdf(balances: BalanceEntry[], totalValue: number, dto: GetBalancePdfDto): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => resolve(Buffer.concat(chunks)));

        this.drawHeader(pdf, dto);
        this.drawTable(pdf, balances, dto.currency);
        this.drawFooter(pdf, totalValue, dto.currency);

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private drawHeader(pdf: InstanceType<typeof PDFDocument>, dto: GetBalancePdfDto): void {
    const { width } = pdf.page;
    const marginX = 50;

    // Title
    pdf.fontSize(24).font('Helvetica-Bold').fillColor('#072440');
    pdf.text('DFX Balance Report', marginX, 50);

    // Date
    pdf.fontSize(12).font('Helvetica').fillColor('#707070');
    const dateStr = Util.isoDate(dto.date);
    pdf.text(`Date: ${dateStr}`, marginX, 85);

    // Blockchain
    pdf.text(`Blockchain: ${dto.blockchain}`, marginX, 105);

    // Address
    pdf.text(`Address: ${dto.address}`, marginX, 125, { width: width - marginX * 2 });

    // Horizontal line
    pdf.moveTo(marginX, 155).lineTo(width - marginX, 155).stroke('#072440');

    pdf.y = 175;
  }

  private drawTable(pdf: InstanceType<typeof PDFDocument>, balances: BalanceEntry[], currency: FiatCurrency): void {
    const marginX = 50;
    const { width } = pdf.page;
    const tableWidth = width - marginX * 2;

    const col1Width = tableWidth * 0.4;
    const col2Width = tableWidth * 0.3;
    const col3Width = tableWidth * 0.3;

    let y = pdf.y + 10;

    // Table header
    pdf.fontSize(11).font('Helvetica-Bold').fillColor('#072440');
    pdf.text('Asset', marginX, y);
    pdf.text('Balance', marginX + col1Width, y);
    pdf.text(`Value (${currency})`, marginX + col1Width + col2Width, y);

    y += 20;
    pdf.moveTo(marginX, y).lineTo(width - marginX, y).stroke('#CCCCCC');
    y += 10;

    // Table rows
    pdf.fontSize(10).font('Helvetica').fillColor('#333333');

    if (balances.length === 0) {
      pdf.text('No assets found for this address.', marginX, y);
      y += 20;
    } else {
      for (const entry of balances) {
        if (y > pdf.page.height - 100) {
          pdf.addPage();
          y = 50;
        }

        pdf.text(entry.asset.name, marginX, y, { width: col1Width - 10 });
        pdf.text(this.formatNumber(entry.balance, 8), marginX + col1Width, y, { width: col2Width - 10 });
        pdf.text(this.formatCurrency(entry.value, currency), marginX + col1Width + col2Width, y, {
          width: col3Width - 10,
        });

        y += 25;
      }
    }

    pdf.moveTo(marginX, y).lineTo(width - marginX, y).stroke('#CCCCCC');
    pdf.y = y + 10;
  }

  private drawFooter(pdf: InstanceType<typeof PDFDocument>, totalValue: number, currency: FiatCurrency): void {
    const marginX = 50;
    const { width } = pdf.page;

    const y = pdf.y + 10;

    pdf.fontSize(12).font('Helvetica-Bold').fillColor('#072440');
    pdf.text('Total Value:', marginX, y);
    pdf.text(this.formatCurrency(totalValue, currency), width - marginX - 150, y, { width: 150, align: 'right' });

    pdf.fontSize(8).font('Helvetica').fillColor('#999999');
    pdf.text('Generated by DFX', marginX, pdf.page.height - 50);
    pdf.text(new Date().toISOString(), marginX, pdf.page.height - 40);
  }

  private formatNumber(value: number, decimals: number): string {
    return value.toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  private formatCurrency(value: number, currency: FiatCurrency): string {
    const symbol = currency === FiatCurrency.CHF ? 'CHF' : currency === FiatCurrency.EUR ? '€' : '$';
    return `${symbol} ${value.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
