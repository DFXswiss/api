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

  @Get('cfp')
  async getDfxCfp(): Promise<any> {
    return this.cfpService.getDfxResults();
  }

  @Get('cfp/all')
  async getAllCfp(): Promise<any> {
    return this.cfpService.getAllCfpResults();
  }

  @Get('cfp/masterNodes')
  async getMasterNodes(): Promise<any> {
    return this.cfpService.getAllMasterNodes();
  }
}
