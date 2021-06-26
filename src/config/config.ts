import * as fs from 'fs';
import * as path from 'path';

export default() => {
    let mariaUri: string;
    const mode: string = process.env.NODE_ENV;

    if(mode == 'master'){
        mariaUri = process.env.MARIA_URI_MASTER;
    }else if(mode === 'develop'){
        mariaUri = process.env.MARIA_URI_DEVELOP;
    }else{
        mariaUri = process.env.MARIA_URI_LOCALHOST;
    }

    const config = {
        port: parseInt(process.env.PORT,10) || 3001,
        mariaUri,
        mode,
        adminToken: process.env.ADMIN_TOKEN,
        maxNumberRecentlyUsed: process.env.NUM_RECENTLY_USED
    }

    return config;
}