#!/bin/bash
CN=$1
NAMESPACE=${2:-dev}
CERTS_PATH="./local/certs"
CA_CERT=$CERTS_PATH/ca.crt
CA_KEY=$CERTS_PATH/ca.key
CA_SRL=$CERTS_PATH/ca.srl
SERVER_KEY=$CERTS_PATH/server.key
SERVER_CSR=$CERTS_PATH/server.csr
SERVER_CRT=$CERTS_PATH/server.crt

mkdir -p $CERTS_PATH

openssl genrsa -out $CA_KEY 2048

openssl req -new -x509 -days 365 -key $CA_KEY \
  -subj "/C=AU/CN=$CN"\
  -out $CA_CERT

openssl req -newkey rsa:2048 -nodes -keyout $SERVER_KEY \
  -subj "/C=AU/CN=$CN" \
  -out $SERVER_CSR

openssl x509 -req \
  -extfile <(printf "subjectAltName=DNS:$CN.$NAMESPACE.svc") \
  -days 365 \
  -in $SERVER_CSR \
  -CA $CA_CERT -CAkey $CA_KEY -CAcreateserial \
  -out $SERVER_CRT
