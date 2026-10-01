FROM node:22-bookworm

ENV LERNA="8.1.9"
ENV NCC="0.38.3"

RUN npm install -g lerna@${LERNA} @vercel/ncc@${NCC}
