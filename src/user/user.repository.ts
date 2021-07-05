import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateUserDto } from "./dto/create-user.dto";
import { User } from "./user.entity";

@EntityRepository(User)
export class UserRepository extends Repository<User> {
    async createUser(createUserDto: CreateUserDto): Promise<void> {
        const user = this.create(createUserDto);

        try {
            await this.save(user);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }
}