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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Buy = void 0;
const typeorm_config_1 = require("../config/typeorm.config");
const typeorm_1 = require("typeorm");
let Buy = class Buy {
};
__decorate([
    typeorm_1.PrimaryColumn({ type: 'varchar', 'unique': true, length: 42 }),
    __metadata("design:type", String)
], Buy.prototype, "id", void 0);
__decorate([
    typeorm_1.Column({ type: "varchar", length: 34 }),
    __metadata("design:type", String)
], Buy.prototype, "address", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 32 }),
    __metadata("design:type", String)
], Buy.prototype, "iban", void 0);
__decorate([
    typeorm_1.Column({ type: 'int', length: 9 }),
    __metadata("design:type", Number)
], Buy.prototype, "asset", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 15 }),
    __metadata("design:type", String)
], Buy.prototype, "bank_usage", void 0);
__decorate([
    typeorm_1.Column({ type: "tinyint", length: 1, default: 1 }),
    __metadata("design:type", Boolean)
], Buy.prototype, "avtive", void 0);
Buy = __decorate([
    typeorm_1.Entity()
], Buy);
exports.Buy = Buy;
//# sourceMappingURL=buy.entity.js.map