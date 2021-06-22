import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
export declare class BuyController {
    private readonly buyService;
    constructor(buyService: BuyService);
    getBuyRoute(): Promise<any>;
    createBuyRoute(buy: Buy, req: any): Promise<any>;
    updateBuyRoute(buy: Buy, req: any): Promise<any>;
}
