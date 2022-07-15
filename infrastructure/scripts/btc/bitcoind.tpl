[Unit]
Description=Bitcoin daemon

After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/home/dfx/.bitcoin/bitcoin-22.0/bin/bitcoind -daemonwait \
                                                       -pid=/run/bitcoind/bitcoind.pid \
                                                       -datadir=/home/dfx/.bitcoin \
                                                       -conf=/home/dfx/.bitcoin/bitcoin.conf
Type=forking
PIDFile=/run/bitcoind/bitcoind.pid
Restart=on-failure
TimeoutStartSec=infinity
TimeoutStopSec=600

User=dfx
Group=dfx

[Install]
WantedBy=multi-user.target