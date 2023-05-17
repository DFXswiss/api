#!/bin/bash
/home/dfx/.bitcoin/bitcoin-22.0/bin/bitcoind -daemonwait \
                                             -datadir=/home/dfx/.bitcoin \
                                             -conf=/home/dfx/.bitcoin/bitcoin.conf \
                                             -maxmempool=3000