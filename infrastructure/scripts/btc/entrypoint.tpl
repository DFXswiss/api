#!/bin/bash
blkid --match-token TYPE=xfs /dev/nvme0n1 || mkfs --type xfs -f /dev/nvme0n1
mkdir /home/dfx/.bitcoin
sudo mkdir /run/bitcoind
mount /dev/nvme0n1 /home/dfx/.bitcoin
chown dfx:dfx /home/dfx/.bitcoin
sudo chown dfx:dfx /run/bitcoind
cd /home/dfx/.bitcoin
wget https://bitcoincore.org/bin/bitcoin-core-22.0/bitcoin-22.0-x86_64-linux-gnu.tar.gz
tar -xzf ./bitcoin-22.0-x86_64-linux-gnu.tar.gz
rm ./bitcoin-22.0-x86_64-linux-gnu.tar.gz
echo "
server=1
rpcallowip=0.0.0.0/0
rpcbind=0.0.0.0
rpcauth=dfx-api:86966de74994d5d96930833b4b6e1131$11fb708701e00db4349ca669863aedc5de90590564c48ff90a899c8c97411e02
wallet=dfx-api
addresstype=p2sh-segwit
" > /home/dfx/.bitcoin/bitcoin.conf
echo "/dev/nvme0n1 ~/.bitcoin xfs defaults,nofail 0 2" >> /etc/fstab
echo "{1}" > /etc/systemd/system/bitcoind.service
systemctl daemon-reload
systemctl enable bitcoin.service
systemctl start bitcoin.service