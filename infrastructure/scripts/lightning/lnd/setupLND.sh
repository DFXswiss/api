#!/bin/bash

mkdir /home/dfx/.lnd
chown dfx:dfx /home/dfx/.lnd
cd /home/dfx/.lnd

wget https://github.com/lightningnetwork/lnd/releases/download/v0.16.2-beta/lnd-linux-amd64-v0.16.2-beta.tar.gz
tar -xzf ./lnd-linux-amd64-v0.16.2-beta.tar.gz
rm ./lnd-linux-amd64-v0.16.2-beta.tar.gz

ln -s lnd-linux-amd64-v0.16.2-beta/lncli .
