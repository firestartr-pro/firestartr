import fs from 'fs';
import https from 'https';

const express = require('express');
const router = express();
const port = 443;
const baseCertPath = '/etc/webhooks/tls';
const tlsKey = fs.readFileSync(`${baseCertPath}/tls.key`, 'utf8');
const tlsCrt = fs.readFileSync(`${baseCertPath}/tls.crt`, 'utf8');
const credentials = { key: tlsKey, cert: tlsCrt };

router.get(
  '/',

  (req: any, res: any) => {
    res.send('Test');
  },
);

const httpsServer = https.createServer(credentials, router);

router.use(express.json());

router.use((req: any, res: any, next: Function) => {
  console.log(JSON.stringify(req.body, null, 2));

  next();
});

router.all(
  '*',

  (req: any, res: any) => {
    res.send({
      apiVersion: 'admission.k8s.io/v1',

      kind: 'AdmissionReview',

      response: {
        uid: req.body.request.uid,

        allowed: true,
      },
    });
  },
);

router.post(
  '/validate-crds',

  (req: any, res: any) => {
    console.log('Validating CRD', req.body.request.kind.group);

    //admission logic
    res.send({
      apiVersion: 'admission.k8s.io/v1',

      kind: 'AdmissionReview',

      response: {
        uid: req.body.request.uid,

        allowed: true,
      },
    });
  },
);

httpsServer.listen(
  port,

  () => {
    console.log('Listening for validations');
  },
);
