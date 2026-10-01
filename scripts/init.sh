if [ $1 != "-s" ]; then
  find . -type d -name "node_modules" -exec rm -rf {} +
  NPM_AUTH_TOKEN=$1 npm install
fi

cd packages/operator

DUMMY=DISABLED DEBUG='firestartr:operator:dummy' ../../node_modules/.bin/ts-node index.ts
