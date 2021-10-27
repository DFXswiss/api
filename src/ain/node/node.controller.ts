import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CommandDto } from './dto/command.dto';
import { NodeMode, NodeService, NodeType } from './node.service';

@Controller('node')
export class NodeController {
  constructor(private readonly nodeService: NodeService) {}

  @Post(':node/:mode/rpc')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async rpc(@Param('node') node: NodeType, @Param('mode') mode: NodeMode, @Body() command: string): Promise<any> {
    return this.nodeService.getClient(node, mode).sendRpcCommand(command);
  }

  @Post(':node/:mode/cmd')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async cmd(@Param('node') node: NodeType, @Param('mode') mode: NodeMode, @Body() dto: CommandDto): Promise<any> {
    try {
      return await this.nodeService.getClient(node, mode).sendCliCommand(dto.command, dto.noAutoUnlock);
    } catch (e) {
      throw new BadRequestException(`Command failed: ${e.message}`);
    }
  }

  @Get(':node/:mode/info')
  @ApiExcludeEndpoint()
  async nodeInfo(@Param('node') node: NodeType, @Param('mode') mode: NodeMode): Promise<BlockchainInfo> {
    return this.nodeService.getClient(node, mode).getInfo();
  }
}
