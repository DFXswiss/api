import { Controller, UseGuards, Post, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FiatInputService } from './fiat-input.service';

@ApiTags('fiatInput')
@Controller('fiatInput')
export class FiatInputController {
  constructor(private readonly fiatInputService: FiatInputService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UseInterceptors(FilesInterceptor('files'))
  async uploadSepaFiles(@UploadedFiles() files: Express.Multer.File[]): Promise<any> {
    // TODO: any
    return this.fiatInputService.storeSepaFiles(files.map((f) => f.buffer.toString()));
  }
}
