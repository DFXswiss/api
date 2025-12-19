#!/bin/bash

case "$1" in
  frontend|backend)
  ;;
  *)
    echo "Invalid parameter '$1'"
    echo "Allowed values are: 'frontend' or 'backend'"
    exit 1
  ;;
esac

composefile=docker-compose-blockscout-citrea-testnet.yml
service=$1

cd /home/dfx

docker compose -f ${composefile} up -d --no-deps --pull always --force-recreate ${service}

docker image prune -f
