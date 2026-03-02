import { Injectable } from '@nestjs/common';
import { Log } from '../log/log.entity';
import { LogService } from '../log/log.service';
import { FinanceLog } from '../log/dto/log.dto';
import { FinancialLogEntryDto, FinancialLogResponseDto } from './dto/financial-log.dto';

@Injectable()
export class DashboardFinancialService {
  constructor(private readonly logService: LogService) {}

  async getFinancialLog(from?: Date, dailySample?: boolean): Promise<FinancialLogResponseDto> {
    const logs = await this.logService.getFinancialLogs(from, dailySample);

    const entries = logs.map((log) => this.mapLogToEntry(log)).filter((e): e is FinancialLogEntryDto => e != null);

    return { entries };
  }

  private mapLogToEntry(log: Log): FinancialLogEntryDto | undefined {
    try {
      const financeLog: FinanceLog = JSON.parse(log.message);

      const btcPriceChf = this.extractBtcPrice(financeLog);

      const balancesByType: Record<string, { plusBalanceChf: number; minusBalanceChf: number }> = {};
      if (financeLog.balancesByFinancialType) {
        for (const [type, data] of Object.entries(financeLog.balancesByFinancialType)) {
          balancesByType[type] = {
            plusBalanceChf: data.plusBalanceChf,
            minusBalanceChf: data.minusBalanceChf,
          };
        }
      }

      return {
        timestamp: log.created,
        totalBalanceChf: financeLog.balancesTotal?.totalBalanceChf ?? 0,
        plusBalanceChf: financeLog.balancesTotal?.plusBalanceChf ?? 0,
        minusBalanceChf: financeLog.balancesTotal?.minusBalanceChf ?? 0,
        btcPriceChf,
        balancesByType,
      };
    } catch {
      return undefined;
    }
  }

  private extractBtcPrice(financeLog: FinanceLog): number {
    if (!financeLog.assets) return 0;

    for (const [, asset] of Object.entries(financeLog.assets)) {
      if (asset.priceChf > 50000) {
        return asset.priceChf;
      }
    }

    return 0;
  }
}
