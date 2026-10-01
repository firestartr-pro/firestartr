import { spawn } from 'child_process';

export async function tfLocal(cr: any, namespace: string, cmd = 'plan') {
  return new Promise((ok: Function, ko: Function) => {
    const executablePath = process.env.IS_DEV_ENVIRONMENT
      ? '/library/scripts/run.sh'
      : '/library/run.sh';

    const ps: any = spawn(
      executablePath,

      [
        'operator',

        `--${cmd}`,

        '--cr',

        Buffer.from(JSON.stringify(cr)).toString('base64'),

        '--namespace',

        namespace,
      ],

      {
        cwd: '/library',
      },
    );

    let output = '';

    ps.stdout.on(
      'data',

      (log: any) => {
        output += log.toString();
      },
    );

    ps.stderr.on(
      'data',

      (log: any) => {
        output += log.toString();
      },
    );

    ps.on(
      'exit',

      async (code: any) => {
        if (code !== 0) {
          ko(output);
        } else {
          console.log(output);

          ok(output);
        }
      },
    );
  });
}
