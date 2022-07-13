#!/bin/bash
mkdir /home/dfx/.bitcoin
chown dfx:dfx /home/dfx/.bitcoin

sudo mkdir /run/bitcoind
sudo chown dfx:dfx /run/bitcoind

cd /home/dfx/.bitcoin
wget https://bitcoincore.org/bin/bitcoin-core-22.0/bitcoin-22.0-x86_64-linux-gnu.tar.gz
tar -xzf ./bitcoin-22.0-x86_64-linux-gnu.tar.gz
rm ./bitcoin-22.0-x86_64-linux-gnu.tar.gz