import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CfpResult, CfpService, MasterNode } from 'src/services/cfp.service';
import { StatisticService } from './statistic.service';

@ApiTags('statistic')
@Controller('statistic')
export class StatisticController {
  constructor(private readonly statisticService: StatisticService, private readonly cfpService: CfpService) {}

  @Get()
  async getAll(): Promise<any> {
    return this.statisticService.getAll();
  }

  @Get('order')
  async getOrder(): Promise<any> {
    return this.statisticService.getRouteCount();
  }

  @Get('order/sell')
  async getSellOrder(): Promise<any> {
    return this.statisticService.getSellRouteCount();
  }

  @Get('order/buy')
  async getBuyOrder(): Promise<any> {
    return this.statisticService.getBuyRouteCount();
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

  @Get('cfp')
  async getCfpList(): Promise<CfpResult[]> {
    const cfpResults = await this.cfpService.getCfpResults('latest');
    return cfpResults.filter((r) => [66, 70].includes(r.number));

    // TODO:
    // return this.cfpService.getCfpList();
  }

  // TODO: remove
  @Get('cfp/all')
  async getAllCfp(): Promise<CfpResult[]> {
    return this.cfpService.getCfpResults('latest');
  }

  @Get('cfp/:id')
  async getCfpResults(@Param('id') cfpId: string): Promise<CfpResult[]> {
    return this.cfpService.getCfpResults(cfpId);
  }

  @Get('cfp/masterNodes')
  async getMasterNodes(): Promise<MasterNode[]> {
    return this.cfpService.getMasterNodes();
  }
}
