import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserData } from './userData.entity';

@EntityRepository(UserData)
export class UserDataRepository extends Repository<UserData> {
  async getAllUserData(): Promise<any> {
    try {
      return await this.find();
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async updateUserData(updatedUser: UpdateUserDataDto): Promise<any> {
    try {
      const user = await this.findOne({ id: updatedUser.id });
      if (!user) throw new NotFoundException('No matching user for id found');

      if (updatedUser.nameCheck) user.nameCheck = updatedUser.nameCheck;

      return await this.save(user);
    } catch (error) {
      throw new ServiceUnavailableException(error.message);
    }
  }
}
