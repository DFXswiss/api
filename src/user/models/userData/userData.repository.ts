import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserData } from './userData.entity';

@EntityRepository(UserData)
export class UserDataRepository extends Repository<UserData> {
  async getAllUserData(): Promise<any> {
    try {
      return await this.find({
        relations: ['bankDatas', 'users'],
      });
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async updateUserData(updatedUser: UpdateUserDataDto): Promise<any> {
    try {
      const userData = await this.findOne({ id: updatedUser.id });
      if (!userData) throw new NotFoundException('No matching user for id found');

      if (updatedUser.nameCheck) userData.nameCheck = updatedUser.nameCheck;
      if (updatedUser.depositLimit) userData.depositLimit = updatedUser.depositLimit;
      if (updatedUser.kycStatus) userData.kycStatus = updatedUser.kycStatus;
      if (updatedUser.kycState) userData.kycState = updatedUser.kycState;

      return await this.save(userData);
    } catch (error) {
      throw new ServiceUnavailableException(error.message);
    }
  }
}
