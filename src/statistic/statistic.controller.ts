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
