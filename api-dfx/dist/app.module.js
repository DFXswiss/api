"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const config_2 = require("./config/config");
const app_controller_1 = require("./app.controller");
const user_controller_1 = require("./user/user.controller");
const buy_controller_1 = require("./buy/buy.controller");
const sell_controller_1 = require("./sell/sell.controller");
const user_service_1 = require("./user/user.service");
const buy_service_1 = require("./buy/buy.service");
const sell_service_1 = require("./sell/sell.service");
let AppModule = class AppModule {
};
AppModule = __decorate([
    common_1.Module({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [config_2.default],
            }),
        ],
        controllers: [app_controller_1.AppController, user_controller_1.UserController, buy_controller_1.BuyController, sell_controller_1.SellController],
        providers: [user_service_1.UserService, buy_service_1.BuyService, sell_service_1.SellService],
        exports: [user_service_1.UserService, buy_service_1.BuyService, sell_service_1.SellService]
    })
], AppModule);
exports.AppModule = AppModule;
//# sourceMappingURL=app.module.js.map