import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateMasternodeDto } from './dto/create-masternode.dto';
import { ResignMasternodeDto } from './dto/resign-masternode.dto';
import { Masternode } from './masternode.entity';
import { MasternodeService } from './masternode.service';

@ApiTags('masternode')
@Controller('masternode')
export class MasternodeController {
  constructor(private readonly masternodeService: MasternodeService) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  getMasternodes(): Promise<Masternode[]> {
    return this.masternodeService.get();
  }

  @Put(':id/create')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  createMasternode(@Param('id') id: string, @Body() dto: CreateMasternodeDto): Promise<Masternode> {
    return this.masternodeService.create(+id, dto);
  }

  @Put(':id/resign')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  async resignMasternode(@Param('id') id: string, @Body() dto: ResignMasternodeDto): Promise<Masternode> {
    return this.masternodeService.resign(+id, dto);
  }
}
