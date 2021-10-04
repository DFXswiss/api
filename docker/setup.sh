#!/usr/bin/env bash
#Run the setup-database script to create the DB and the schema in the DB
#do this in a loop because the timing for when the SQL instance is ready is indeterminate
for i in {1..50};
do
    /opt/mssql-tools/bin/sqlcmd -S localhost -U sql-admin -P BaQh5@yB68V423eX@pGm -d master -i setup-database.sql
    if [ $? -eq 0 ]
    then
        echo "setup-database.sql completed"
        break
    else
        echo "not ready yet..."
        sleep 1
    fi
done