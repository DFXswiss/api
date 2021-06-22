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
exports.SellController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const user_guard_1 = require("../auth/user.guard");
const sell_entity_1 = require("./sell.entity");
const sell_service_1 = require("./sell.service");
let SellController = class SellController {
    constructor(sellService) {
        this.sellService = sellService;
    }
    async getSellRoute() {
        return this.sellService.findSellByAddress();
    }
    async createSellRoute(buy, req) {
        if (this.sellService.findSellByAddress() != null)
            return "Already exist";
        return this.sellService.createSell(buy);
    }
    async updateSellRoute(buy, req) {
        if (this.sellService.findSellByAddress() == null)
            return "Not exist";
        return this.sellService.updateSell(buy);
    }
};
__decorate([
    common_1.Get(),
    common_1.UseGuards(user_guard_1.UserGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SellController.prototype, "getSellRoute", null);
__decorate([
    common_1.Post(),
    common_1.UseGuards(user_guard_1.UserGuard),
    __param(0, common_1.Body()),
    __param(1, common_1.Request()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sell_entity_1.Sell, Object]),
    __metadata("design:returntype", Promise)
], SellController.prototype, "createSellRoute", null);
__decorate([
    common_1.Put(),
    common_1.UseGuards(user_guard_1.UserGuard),
    __param(0, common_1.Body()),
    __param(1, common_1.Request()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sell_entity_1.Sell, Object]),
    __metadata("design:returntype", Promise)
], SellController.prototype, "updateSellRoute", null);
SellController = __decorate([
    swagger_1.ApiTags('sell'),
    common_1.Controller('sell'),
    __metadata("design:paramtypes", [sell_service_1.SellService])
], SellController);
exports.SellController = SellController;
//# sourceMappingURL=sell.controller.js.map