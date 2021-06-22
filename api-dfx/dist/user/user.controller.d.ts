import { User } from './user.entity';
import { UserService } from './user.service';
export declare class UserController {
    private readonly userService;
    constructor(userService: UserService);
    getUser(): Promise<any>;
    createUser(user: User, req: any): Promise<string>;
    updateUser(user: User, req: any): Promise<string>;
}
