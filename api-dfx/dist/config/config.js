"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => {
    let mariaUri;
    const mode = process.env.NODE_ENV;
    if (mode == 'master') {
        mariaUri = process.env.MARIA_URI_MASTER;
    }
    else if (mode === 'develop') {
        mariaUri = process.env.MARIA_URI_DEVELOP;
    }
    else {
        mariaUri = process.env.MARIA_URI_LOCALHOST;
    }
    const config = {
        port: parseInt(process.env.PORT, 10) || 3001,
        mariaUri,
        mode,
        adminToken: process.env.ADMIN_TOKEN,
        maxNumberRecentlyUsed: process.env.NUM_RECENTLY_USED
    };
    return config;
};
//# sourceMappingURL=config.js.map