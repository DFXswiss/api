import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToClass, Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, ValidateIf, ValidateNested, validateSync } from 'class-validator';
import { NodeService } from 'src/integration/blockchain/ain/node/node.service';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';

interface BankingBotData {
  bank: BankingBotFileData[];
  dfx: BankingBotFileData[];
}

interface BankingBotFileData {
  date: string;
  fileName: string;
  status: string;
  message?: string;
}

class BankingBotFileDataDto {
  @IsNotEmpty()
  @IsString()
  date: string;

  @IsNotEmpty()
  @IsString()
  fileName: string;

  @IsNotEmpty()
  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  message: string;
}

class BankingBotDataDto {
  @IsNotEmpty()
  @ValidateIf((o: BankingBotDataDto) => Boolean(!o.dfx || o.bank))
  @ValidateNested()
  @Type(() => BankingBotFileDataDto)
  bank: BankingBotFileDataDto;

  @IsNotEmpty()
  @ValidateIf((o: BankingBotDataDto) => Boolean(!o.bank || o.dfx))
  @ValidateNested()
  @Type(() => BankingBotFileDataDto)
  dfx: BankingBotFileDataDto;
}

@Injectable()
export class BankingBotObserver extends MetricObserver<BankingBotData> {
  constructor(monitoringService: MonitoringService, readonly nodeService: NodeService) {
    super(monitoringService, 'bankingBot', 'logs');
  }

  async onWebhook(_dto: unknown): Promise<void> {
    const dto = this.createDto(_dto);
    const validationErrors = validateSync(dto);

    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors, 'Invalid banking-bot logs input');
    }

    const data = this.data || (await this.initBankingBotData());

    if (!data.bank) data.bank = [];
    if (!data.dfx) data.dfx = [];

    // reducing from dto to simple objects to pas isEqual check in monitoring.service
    if (dto.bank) data.bank.push({ ...dto.bank });
    if (dto.dfx) data.dfx.push({ ...dto.dfx });

    this.emit(data);
  }

  private createDto(_dto: unknown): BankingBotDataDto {
    const dto = plainToClass(BankingBotDataDto, _dto);

    if (!(dto instanceof BankingBotDataDto)) {
      throw new BadRequestException('Invalid banking-bot logs input');
    }

    return dto;
  }

  private async initBankingBotData(): Promise<BankingBotData> {
    const data = await this.load();

    const isValid = this.isParsedDataValid(data);

    return data && isValid
      ? data
      : {
          bank: [],
          dfx: [],
        };
  }

  private isParsedDataValid(data: BankingBotData | any): boolean {
    return data && data.bank && Array.isArray(data.bank) && data.dfx && Array.isArray(data.dfx);
  }
}
