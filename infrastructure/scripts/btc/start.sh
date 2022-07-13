#!/bin/bash
/home/dfx/.bitcoin/bitcoin-22.0/bin/bitcoind -daemonwait \
                                             -pid=/run/bitcoind/bitcoind.pid \
                                             -datadir=/home/dfx/.bitcoin \
                                             -conf=/home/dfx/.bitcoin/bitcoin.conf