import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { NodeService, NodeType } from './node.service';

@Controller('node')
export class NodeController {
  constructor(private readonly nodeService: NodeService) {}

  // TODO: disable on prod?
  @Post(':node/rpc')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async forwardActive(@Param('node') node: NodeType, @Body() command: string): Promise<any> {
    return this.nodeService.forward(node, command);
  }

  @Get(':node/info')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async activeNodeInfo(@Param('node') node: NodeType): Promise<BlockchainInfo> {
    return this.nodeService.getInfo(node);
  }
}
