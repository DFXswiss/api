import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CfpService } from 'src/services/cfp.service';
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

  @Get('cfp')
  async getDfxCfp(): Promise<any> {
    return this.cfpService.getDfxResults();
  }

  @Get('cfp/all')
  async getAllCfp(): Promise<any> {
    return this.cfpService.getAllCfpResults();
  }

  @Get('cfp/invalidVotes')
  async getInvalidVotes(): Promise<any> {
    return this.cfpService.getAllInvalidVotes();
  }

  @Get('cfp/masterNodes')
  async getMasterNodes(): Promise<any> {
    return this.cfpService.getAllMasterNodes();
  }
}
