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

  @Get('order')
  async getOrder(): Promise<any> {
    return this.statisticService.getRoutes();
  }

  @Get('order/sell')
  async getSellOrder(): Promise<any> {
    return this.statisticService.getSellRoutes();
  }

  @Get('order/buy')
  async getBuyOrder(): Promise<any> {
    return this.statisticService.getBuyRoutes();
  }

  @Get('volume')
  async getVolume(): Promise<any> {
    return this.statisticService.getDFIVolume();
  }

  @Get('volume/buy')
  async getBuyVolume(): Promise<any> {
    return this.statisticService.getDFIBuyVolume();
  }

  @Get('volume/sell')
  async getSellVolume(): Promise<any> {
    return this.statisticService.getDFISellVolume();
  }
}
