#!/bin/bash

timestamp=`date +%Y%m%d%H%M%S`

/usr/bin/cp ./startBTC.sh ./backup/${timestamp}-startBTC.sh
/usr/bin/cp ./startLND.sh ./backup/${timestamp}-startLND.sh
/usr/bin/cp ./startLNbits.sh ./backup/${timestamp}-startLNbits.sh
/usr/bin/cp ./startThunderHub.sh ./backup/${timestamp}-startThunderHub.sh

/usr/bin/zip -r ./backup/${timestamp}-bitcoin.zip ./.bitcoin/bitcoin.conf ./.bitcoin/dfx-api
/usr/bin/zip -r ./backup/${timestamp}-lightning.zip ./.lnd
/usr/bin/zip -r ./backup/${timestamp}-lnbits.zip ./lnbits ./lnbits-extensions
/usr/bin/zip -r ./backup/${timestamp}-thunderhub.zip ./thunderhub
