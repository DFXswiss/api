#!/bin/bash

cd /home/dfx/lnbits

poetry run lnbits > /home/dfx/lnbits/logs/lnbits.log 2>&1 &

cd /home/dfx
