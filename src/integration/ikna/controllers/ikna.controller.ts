import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserGuard } from 'src/shared/auth/user.guard';
import { IknaAddressTag } from '../dto/ikna-address-tag.dto';
import { IknaAddressQuery, IknaBfsAddressQuery } from '../dto/ikna-query.dto';
import { IknaSanctionResult } from '../dto/ikna-sanction-result.dto';
import { IknaService } from '../services/ikna.service';

@ApiTags('ikna')
@Controller('ikna')
export class IknaController {
  constructor(private readonly iknaService: IknaService) {}

  @Post('bfs/address')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async createBfsAddressRequest(@Query() query: IknaBfsAddressQuery): Promise<number> {
    return this.iknaService.doAddressBFS(query.address, query.blockchain, +query.depth);
  }

  @Get('bfs/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async getBfsResult(@Param('id') id: string): Promise<IknaSanctionResult> {
    return this.iknaService.getBfsResult(+id);
  }

  @Get('tag')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async getIknaAddressTag(@Query() query: IknaAddressQuery): Promise<IknaAddressTag[]> {
    return this.iknaService.getAddressTags(query.address, query.blockchain);
  }
}
