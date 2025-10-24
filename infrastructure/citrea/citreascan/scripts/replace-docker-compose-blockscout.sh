#!/bin/bash

cd /home/dfx/update

SOURCE_FILE=docker-compose-blockscout-citrea-testnet.yml.template
TARGET_FILE=docker-compose-blockscout-citrea-testnet.yml

INSERT_BACKEND_FILE=docker-compose-blockscout-citrea-testnet.backend.env
INSERT_FRONTEND_FILE=docker-compose-blockscout-citrea-testnet.frontend.env

awk -v f1="${INSERT_BACKEND_FILE}" -v p1="[${INSERT_BACKEND_FILE}]" -v f2="${INSERT_FRONTEND_FILE}" -v p2="[${INSERT_FRONTEND_FILE}]" '
index($0, p1) {
  while ((getline line < f1) > 0) {
    if (line ~ /^\s*$/) continue
    if (line ~ /^\s*#.*$/) continue

    print "      - " line
  }
  close(f1)
  next
}
index($0, p2) {
  while ((getline line < f2) > 0) {
    if (line ~ /^\s*$/) continue
    if (line ~ /^\s*#.*$/) continue

    print "      - " line
  }
  close(f2)
  next
}
{ print }
' ${SOURCE_FILE} > ${TARGET_FILE}

cp ${TARGET_FILE} ../${TARGET_FILE}
