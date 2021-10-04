FROM mcr.microsoft.com/mssql/server

USER root

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY setup-database.sql setup-database.sql
COPY setup.sh setup.sh
COPY entrypoint.sh entrypoint.sh

# Grant permissions for the setup.sh script to be executable
RUN chmod +x ./entrypoint.sh
RUN chmod +x ./setup.sh

USER mssql
CMD /bin/bash ./entrypoint.sh