import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToClass, Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, ValidateNested, validateSync } from 'class-validator';
import { NodeService } from 'src/ain/node/node.service';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';

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
  @IsOptional()
  @ValidateNested()
  @Type(() => BankingBotFileDataDto)
  bank: BankingBotFileDataDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BankingBotFileDataDto)
  dfx: BankingBotFileDataDto;
}

@Injectable()
export class BankingBotObserver extends MetricObserver<BankingBotData> {
  constructor(monitoringService: MonitoringService, readonly nodeService: NodeService) {
    super(monitoringService, 'bankingBot', 'logs');
  }

  onWebhook(_dto: unknown) {
    const dto = this.createDto(_dto);
    const validationErrors = validateSync(dto);

    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors, 'Invalid banking-bot logs input');
    }

    const data = this.$data.value || this.initBankingBotData();

    if (!data.bank) data.bank = [];
    if (!data.dfx) data.dfx = [];

    if (dto.bank) data.bank.push(dto.bank);
    if (dto.dfx) data.dfx.push(dto.dfx);

    this.emit(data);
  }

  createDto(_dto: unknown): BankingBotDataDto {
    const dto = plainToClass(BankingBotDataDto, _dto);

    if (!(dto instanceof BankingBotDataDto)) {
      throw new BadRequestException('Invalid banking-bot logs input');
    }

    return dto;
  }

  private initBankingBotData(): BankingBotData {
    return {
      bank: [],
      dfx: [],
    };
  }
}
