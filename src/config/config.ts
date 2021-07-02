import * as fs from 'fs';
import * as path from 'path';

export default() => {
    let sqlUri: string;
    const mode: string = process.env.NODE_ENV;

    if(mode == 'master'){
        sqlUri = process.env.MARIA_URI_MASTER;
    }else if(mode === 'develop'){
        sqlUri = process.env.MARIA_URI_DEVELOP;
    }else{
        sqlUri = process.env.MARIA_URI_LOCALHOST;
    }

    const config = {
        port: parseInt(process.env.PORT,10) || 3000,
        sqlUri,
        mode,
        adminToken: process.env.ADMIN_TOKEN,
        maxNumberRecentlyUsed: process.env.NUM_RECENTLY_USED,
        type: process.env.SQL_TYPE,
        host: process.env.SQL_HOST,
        sql_port: process.env.SQL_PORT,
        username: process.env.SQL_USERNAME,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DATABASE
    }

    return config;
}