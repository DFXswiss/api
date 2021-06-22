import { Sell } from './sell.entity';
import { SellService } from './sell.service';
export declare class SellController {
    private readonly sellService;
    constructor(sellService: SellService);
    getSellRoute(): Promise<any>;
    createSellRoute(buy: Sell, req: any): Promise<string>;
    updateSellRoute(buy: Sell, req: any): Promise<string>;
}
