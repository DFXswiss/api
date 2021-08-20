import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StatisticService } from './statistic.service';

@ApiTags('statistic')
@Controller('statistic')
export class StatisticController {
  constructor(private readonly statisticService: StatisticService) {}

  @Get()
  async getAll(): Promise<any> {
    return this.statisticService.getAll();
  }

  @Get('buy')
  async getBuyCount(): Promise<any> {
    return this.statisticService.getBuyCount();
  }

  @Get('sell')
  async getSellCount(): Promise<any> {
    return this.statisticService.getSellCount();
  }

  @Get('payment')
  async getPaymentValues(): Promise<any> {
    return this.statisticService.getPaymentValues();
  }
}
