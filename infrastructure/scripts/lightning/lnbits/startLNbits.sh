#!/bin/bash

export PATH="/home/dfx/.local/bin:$PATH"

cd /home/dfx/lnbits

# "lnd" self-signed certificate
poetry run lnbits --ssl-keyfile /home/dfx/.lnd/tls.key --ssl-certfile /home/dfx/.lnd/tls.cert > /home/dfx/lnbits/logs/lnbits.log 2>&1 &

cd /home/dfx
