import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { KycInfoDto } from '../dto/kyc-info.dto';
import { KycStepName } from '../enums/kyc.enum';
import { KycService } from '../services/kyc.service';

@ApiTags('kyc')
@Controller('kyc')
export class UserDataController {
  constructor(private readonly kycService: KycService) {}

  @Get(':code')
  @UseGuards(AuthGuard())
  @ApiOkResponse({ type: KycInfoDto })
  async getKycInfo(@Param('code') code: string): Promise<KycInfoDto> {
    return this.kycService.getKycInfo(code);
  }

  @Get(':code/:state')
  @UseGuards(AuthGuard())
  @ApiOkResponse({ type: KycInfoDto })
  async getStep(@Param('code') code: string, @Param('step') stepName: KycStepName): Promise<KycInfoDto> {
    return this.kycService.getOrCreate(code, stepName);
  }
}
