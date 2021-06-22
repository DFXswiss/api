"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuyController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const user_guard_1 = require("../auth/user.guard");
const buy_entity_1 = require("./buy.entity");
const buy_service_1 = require("./buy.service");
let BuyController = class BuyController {
    constructor(buyService) {
        this.buyService = buyService;
    }
    async getBuyRoute() {
        return this.buyService.findBuyByAddress();
    }
    async createBuyRoute(buy, req) {
        if (this.buyService.findBuyByAddress() != null)
            return "Already exist";
        return this.buyService.createBuy(buy);
    }
    async updateBuyRoute(buy, req) {
        if (this.buyService.findBuyByAddress() == null)
            return "Not exist";
        return this.buyService.updateBuy(buy);
    }
};
__decorate([
    common_1.Get(),
    common_1.UseGuards(user_guard_1.UserGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BuyController.prototype, "getBuyRoute", null);
__decorate([
    common_1.Post(),
    common_1.UseGuards(user_guard_1.UserGuard),
    __param(0, common_1.Body()),
    __param(1, common_1.Request()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [buy_entity_1.Buy, Object]),
    __metadata("design:returntype", Promise)
], BuyController.prototype, "createBuyRoute", null);
__decorate([
    common_1.Put(),
    common_1.UseGuards(user_guard_1.UserGuard),
    __param(0, common_1.Body()),
    __param(1, common_1.Request()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [buy_entity_1.Buy, Object]),
    __metadata("design:returntype", Promise)
], BuyController.prototype, "updateBuyRoute", null);
BuyController = __decorate([
    swagger_1.ApiTags('buy'),
    common_1.Controller('buy'),
    __metadata("design:paramtypes", [buy_service_1.BuyService])
], BuyController);
exports.BuyController = BuyController;
//# sourceMappingURL=buy.controller.js.map