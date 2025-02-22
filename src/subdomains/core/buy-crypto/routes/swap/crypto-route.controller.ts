import { Controller, Get, HttpStatus, Param, Post, Put, Redirect, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';

@ApiTags('CryptoRoute')
@Controller('cryptoRoute')
@ApiExcludeController()
export class CryptoRouteController {
  // --- DEPRECATED ENDPOINTS --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserActiveGuard)
  @ApiExcludeEndpoint()
  @Redirect('swap', 301)
  async getAllCrypto(): Promise<void> {
    // Nothing to do (redirect to swap)
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserActiveGuard)
  @ApiExcludeEndpoint()
  async getCrypto(@Param('id') id: string, @Res() res): Promise<void> {
    // Redirecting to swap
    res.redirect(HttpStatus.MOVED_PERMANENTLY, `/v1/swap/${id}`);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserActiveGuard)
  @ApiExcludeEndpoint()
  @Redirect('swap', 301)
  async createCrypto(): Promise<void> {
    // nothing to do (redirect to swap)
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserActiveGuard)
  @ApiExcludeEndpoint()
  async updateCryptoRoute(@Param('id') id: string, @Res() res): Promise<void> {
    // Redirecting to swap
    res.redirect(HttpStatus.MOVED_PERMANENTLY, `/v1/swap/${id}`);
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getCryptoRouteHistory(@Param('id') id: string, @Res() res): Promise<void> {
    // Redirecting to swap
    res.redirect(HttpStatus.MOVED_PERMANENTLY, `/v1/swap/${id}/history`);
  }
}
