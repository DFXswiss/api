import { Body, Controller, Delete, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateUserDataRelationDto } from './dto/create-user-data-relation.dto';
import { UpdateUserDataRelationDto } from './dto/update-user-data-relation.dto';
import { UserDataRelation } from './user-data-relation.entity';
import { UserDataRelationService } from './user-data-relation.service';

@ApiTags('UserDataRelation')
@Controller('userDataRelation')
@ApiExcludeController()
export class UserDataRelationController {
  constructor(private readonly userDataRelationService: UserDataRelationService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async create(@Body() dto: CreateUserDataRelationDto): Promise<UserDataRelation> {
    return this.userDataRelationService.createUserDataRelation(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateUserData(@Param('id') id: string, @Body() dto: UpdateUserDataRelationDto): Promise<UserDataRelation> {
    return this.userDataRelationService.updateUserDataRelation(+id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async delete(@Param('id') id: string): Promise<void> {
    return this.userDataRelationService.deleteUserDataRelation(+id);
  }
}
