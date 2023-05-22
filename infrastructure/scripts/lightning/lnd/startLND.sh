#!/bin/bash

pipefile=/tmp/wallet-password-pipe

if test -f ${pipefile}; then
  rm ${pipefile}
fi

mkfifo ${pipefile}
pass lnd/my-wallet-password > ${pipefile} &

/home/dfx/.lnd/lnd-linux-amd64-v0.16.2-beta/lnd --bitcoin.mainnet --wallet-unlock-password-file=${pipefile} &
