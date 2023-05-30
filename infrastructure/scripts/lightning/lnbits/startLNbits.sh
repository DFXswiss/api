#!/bin/bash

cd /home/dfx/lnbits

# only accessible on localhost, extern accessible via apache proxy webserver with "official" ssl certificate
# poetry run lnbits --host 127.0.0.1 --port 5000 > /home/dfx/lnbits/logs/lnbits.log 2>&1 &

# externally accessible via given port and "lnd" self-signed certificate
poetry run lnbits --host 0.0.0.0 --port 5000 --ssl-keyfile /home/dfx/.lnd/tls.key --ssl-certfile /home/dfx/.lnd/tls.cert > /home/dfx/lnbits/logs/lnbits.log 2>&1 &

cd /home/dfx
