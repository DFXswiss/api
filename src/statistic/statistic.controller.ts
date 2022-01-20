import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CfpResult, CfpService, MasterNode } from 'src/statistic/cfp.service';
import { StatisticService } from './statistic.service';

@ApiTags('statistic')
@Controller('statistic')
export class StatisticController {
  constructor(private readonly statisticService: StatisticService, private readonly cfpService: CfpService) {}

  @Get()
  async getAll(): Promise<any> {
    return this.statisticService.getAll();
  }

  @Get('status')
  async getStatus(): Promise<any> {
    return this.statisticService.getStatus();
  }

  @Get('cfp/masterNodes')
  async getMasterNodes(): Promise<MasterNode[]> {
    return this.cfpService.getMasterNodes();
  }

  @Get('cfp')
  async getCfpList(): Promise<string[]> {
    return this.cfpService.getCfpList();
  }

  @Get('cfp/:id')
  async getCfpResults(@Param('id') cfpId: string): Promise<CfpResult[]> {
    return this.cfpService.getCfpResults(cfpId);
  }
}
