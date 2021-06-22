"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");
const chalk = require("chalk");
const swagger_1 = require("@nestjs/swagger");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.use(morgan('dev'));
    app.use(helmet());
    app.use(cors());
    app.setGlobalPrefix('v1');
    const swaggerOptions = new swagger_1.DocumentBuilder()
        .setTitle('DFX-API')
        .setDescription('Paste description here')
        .setVersion('0.1')
        .build();
    const swaggerDocument = swagger_1.SwaggerModule.createDocument(app, swaggerOptions);
    swagger_1.SwaggerModule.setup('/api', app, swaggerDocument);
    const config = app.get(config_1.ConfigService);
    await app.listen(3000);
    console.log(chalk.blue.inverse(`Server listening on: ${await app.getUrl()} on ${config.get('mode')} mode`));
}
bootstrap();
//# sourceMappingURL=main.js.map