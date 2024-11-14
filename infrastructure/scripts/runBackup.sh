#!/bin/bash

timestamp=`date +%Y%m%d%H%M%S`
backup_dir=./backup/${timestamp}

echo "Backup to ${backup_dir} ..."

/usr/bin/mkdir ${backup_dir}

/usr/bin/cp ./runBackup.sh ${backup_dir}
/usr/bin/cp ./runBackup-exclude-file.txt ${backup_dir}

/usr/bin/cp ./docker-compose.sh ${backup_dir}
/usr/bin/cp ./docker-compose-bitcoin.yml ${backup_dir}
/usr/bin/cp ./docker-compose-monero.yml ${backup_dir}
/usr/bin/cp ./docker-compose-frankencoin.yml ${backup_dir}

/usr/bin/tar --exclude-from="runBackup-exclude-file.txt" -cpzvf ${backup_dir}/bitcoin.tgz ./volumes/bitcoin
/usr/bin/tar --exclude-from="runBackup-exclude-file.txt" -cpzvf ${backup_dir}/bitmonero.tgz ./volumes/bitmonero
/usr/bin/tar --exclude-from="runBackup-exclude-file.txt" -cpzvf ${backup_dir}/lightning.tgz ./volumes/lightning
/usr/bin/tar --exclude-from="runBackup-exclude-file.txt" -cpzvf ${backup_dir}/lnbits.tgz ./volumes/lnbits
/usr/bin/tar --exclude-from="runBackup-exclude-file.txt" -cpzvf ${backup_dir}/thunderhub.tgz ./volumes/thunderhub
/usr/bin/tar --exclude-from="runBackup-exclude-file.txt" -cpzvf ${backup_dir}/nginx.tgz ./volumes/nginx
/usr/bin/tar --exclude-from="runBackup-exclude-file.txt" -cpzvf ${backup_dir}/frankencoin.tgz ./volumes/frankencoin

echo "... done"
