import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AccountMergeService } from './account-merge.service';

@ApiTags('Merge')
@Controller('merge')
@ApiExcludeController()
export class AccountMergeController {
  constructor(private readonly mergeService: AccountMergeService) {}

  @Get()
  async executeLinkAddress(@Query('code') code: string, @Res() res: Response): Promise<void> {
    const { master } = await this.mergeService.executeMerge(code);
    res.redirect(master.kycUrl);
  }
}
