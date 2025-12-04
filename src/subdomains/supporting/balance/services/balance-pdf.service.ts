import { BadRequestException, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BalanceEntry, PdfUtil } from 'src/shared/utils/pdf.util';
import { Util } from 'src/shared/utils/util';
import { AssetPricesService } from '../../pricing/services/asset-prices.service';
import { CoinGeckoService } from '../../pricing/services/integration/coin-gecko.service';
import { PriceCurrency } from '../../pricing/services/pricing.service';
import { GetBalancePdfDto, PdfLanguage } from '../dto/input/get-balance-pdf.dto';

// Supported EVM blockchains (must have Alchemy support and chainId mapping)
const SUPPORTED_BLOCKCHAINS: Blockchain[] = [
  Blockchain.ETHEREUM,
  Blockchain.BINANCE_SMART_CHAIN,
  Blockchain.POLYGON,
  Blockchain.ARBITRUM,
  Blockchain.OPTIMISM,
  Blockchain.BASE,
  Blockchain.GNOSIS,
];

@Injectable()
export class BalancePdfService {
  private readonly logger = new DfxLogger(BalancePdfService);

  constructor(
    private readonly alchemyService: AlchemyService,
    private readonly assetService: AssetService,
    private readonly assetPricesService: AssetPricesService,
    private readonly coinGeckoService: CoinGeckoService,
    private readonly i18n: I18nService,
  ) {}

  async generateBalancePdf(dto: GetBalancePdfDto): Promise<string> {
    if (!SUPPORTED_BLOCKCHAINS.includes(dto.blockchain)) {
      throw new BadRequestException(
        `Blockchain ${dto.blockchain} is not supported. Supported blockchains: ${SUPPORTED_BLOCKCHAINS.join(', ')}`,
      );
    }

    if (dto.date > new Date()) {
      throw new BadRequestException('Date must be in the past');
    }

    const balances = await this.getBalancesForAddress(dto.address, dto.blockchain, dto.currency, dto.date);
    const totalValue = balances.reduce((sum, b) => sum + (b.value ?? 0), 0);
    const hasIncompleteData = balances.some((b) => b.value == null);

    return this.createPdf(balances, totalValue, hasIncompleteData, dto);
  }

  private async getBalancesForAddress(
    address: string,
    blockchain: Blockchain,
    currency: PriceCurrency,
    date: Date,
  ): Promise<BalanceEntry[]> {
    const chainId = EvmUtil.getChainId(blockchain);
    const allAssets = await this.assetService.getAllBlockchainAssets([blockchain]);
    const assets = allAssets.filter((a) => ![AssetType.PRESALE, AssetType.CUSTOM].includes(a.type));
    const balances: BalanceEntry[] = [];

    // Find block number for the target date
    const targetTimestamp = Math.floor(date.getTime() / 1000);
    const blockNumber = await this.alchemyService.findBlockByTimestamp(chainId, targetTimestamp);

    // Get native coin balance at historical block
    const nativeCoinBalance = await this.alchemyService.getNativeCoinBalance(chainId, address, blockNumber);
    const nativeCoin = assets.find((a) => !a.chainId);
    if (nativeCoin && nativeCoinBalance) {
      const balance = EvmUtil.fromWeiAmount(nativeCoinBalance, 18);
      if (balance > 0) {
        const price = await this.getHistoricalPrice(nativeCoin, blockchain, date, currency);
        balances.push({
          asset: nativeCoin,
          balance,
          price,
          value: price != null ? balance * price : undefined,
        });
      }
    }

    // Get token balances at historical block (parallelized in batches)
    const tokenAssets = assets.filter((a) => a.chainId != null);
    const BATCH_SIZE = 10;

    for (let i = 0; i < tokenAssets.length; i += BATCH_SIZE) {
      const batch = tokenAssets.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (asset) => {
          try {
            const rawBalance = await this.alchemyService.getTokenBalanceAtBlock(
              chainId,
              address,
              asset.chainId,
              blockNumber,
            );
            const balance = EvmUtil.fromWeiAmount(rawBalance, asset.decimals ?? 18);
            if (balance > 0) {
              const price = await this.getHistoricalPrice(asset, blockchain, date, currency);
              return {
                asset,
                balance,
                price,
                value: price != null ? balance * price : undefined,
              };
            }
            return null;
          } catch (e) {
            this.logger.warn(`Failed to fetch balance for asset ${asset.name} (${asset.uniqueName}):`, e);
            return null;
          }
        }),
      );

      balances.push(...batchResults.filter((b): b is BalanceEntry => b !== null));
    }

    return PdfUtil.sortBalancesByValue(balances);
  }

  private async getHistoricalPrice(
    asset: Asset,
    blockchain: Blockchain,
    date: Date,
    currency: PriceCurrency,
  ): Promise<number | undefined> {
    // First, check local database for historical price
    const localPrice = await this.assetPricesService.getAssetPriceForDate(asset.id, date);
    if (localPrice) {
      switch (currency) {
        case PriceCurrency.CHF:
          return localPrice.priceChf;
        case PriceCurrency.EUR:
          return localPrice.priceEur;
        case PriceCurrency.USD:
          return localPrice.priceUsd;
      }
    }

    // Fallback to CoinGecko for historical price
    const currencyLower = currency.toLowerCase() as 'usd' | 'eur' | 'chf';
    return this.coinGeckoService.getHistoricalPriceForAsset(blockchain, asset.chainId, date, currencyLower);
  }

  private createPdf(
    balances: BalanceEntry[],
    totalValue: number,
    hasIncompleteData: boolean,
    dto: GetBalancePdfDto,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];
        const language = dto.language ?? PdfLanguage.EN;

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => {
          const base64PDF = Buffer.concat(chunks).toString('base64');
          resolve(base64PDF);
        });

        PdfUtil.drawLogo(pdf);
        this.drawHeader(pdf, dto, language);
        PdfUtil.drawTable(pdf, balances, dto.currency, language, this.i18n);
        PdfUtil.drawFooter(pdf, totalValue, hasIncompleteData, dto.currency, language, this.i18n);

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private drawHeader(pdf: InstanceType<typeof PDFDocument>, dto: GetBalancePdfDto, language: PdfLanguage): void {
    const { width } = pdf.page;
    const marginX = 50;

    pdf.fontSize(20).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(PdfUtil.translate('balance.title', language, this.i18n), marginX, 75);

    pdf.fontSize(11).font('Helvetica').fillColor('#707070');
    const dateStr = Util.isoDate(dto.date);
    pdf.text(`${PdfUtil.translate('balance.date', language, this.i18n)}: ${dateStr}`, marginX, 105);

    pdf.text(`${PdfUtil.translate('balance.blockchain', language, this.i18n)}: ${dto.blockchain}`, marginX, 123);

    pdf.text(`${PdfUtil.translate('balance.address', language, this.i18n)}: ${dto.address}`, marginX, 141, {
      width: width - marginX * 2,
    });

    pdf
      .moveTo(marginX, 170)
      .lineTo(width - marginX, 170)
      .stroke('#072440');

    pdf.y = 190;
  }
}
