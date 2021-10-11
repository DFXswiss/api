import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CommandDto } from './dto/command.dto';
import { NodeService, NodeType } from './node.service';

@Controller('node')
export class NodeController {
  constructor(private readonly nodeService: NodeService) {}

  // TODO: disable on prod?
  @Post(':node/rpc')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async rpc(@Param('node') node: NodeType, @Body() command: string): Promise<any> {
    return this.nodeService.forward(node, command);
  }

  @Post(':node/cmd')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async cmd(@Param('node') node: NodeType, @Body() dto: CommandDto): Promise<any> {
    return this.nodeService.sendCommand(node, dto.command, dto.noAutoUnlock);
  }

  @Get(':node/info')
  @ApiExcludeEndpoint()
  async nodeInfo(@Param('node') node: NodeType): Promise<BlockchainInfo> {
    return this.nodeService.getInfo(node);
  }
}
