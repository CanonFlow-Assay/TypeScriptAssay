#!/usr/bin/env node
import { canonical, intake, planChange, verifyApplication, investigate } from './index.mjs';
const [command, ...args] = process.argv.slice(2);
const options = {};
try {
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        '--manifest',
        '--output',
        '--baseline',
        '--request',
        '--plan',
        '--failure',
        '--run',
        '--probe'
      ].includes(args[i]) ||
      !args[i + 1] ||
      Object.hasOwn(options, args[i])
    )
      throw new Error('Invalid lifecycle option');
    options[args[i]] = args[i + 1];
  }
  if (!options['--manifest'] || !options['--output'])
    throw new Error('Manifest and fresh output directory are required');
  const result =
    command === 'intake'
      ? intake(options['--manifest'], options['--output'])
      : command === 'plan'
        ? planChange(
            options['--manifest'],
            options['--baseline'],
            options['--request'],
            options['--output']
          )
        : command === 'verify'
          ? verifyApplication(options['--manifest'], options['--output'], {
              baseline: options['--baseline'],
              plan: options['--plan'],
              failure: options['--failure']
            })
          : command === 'investigate'
            ? investigate(
                options['--manifest'],
                options['--run'],
                options['--probe'],
                options['--output']
              )
            : (() => {
                throw new Error('Unknown lifecycle command');
              })();
  process.stdout.write(canonical(result));
  process.exitCode =
    result.assessment?.status === 'NotReady'
      ? 1
      : result.assessment?.status === 'ContextRequired' ||
          result.status === 'ContextRequired' ||
          result.status === 'BudgetExhausted'
        ? 2
        : 0;
} catch (error) {
  process.stdout.write(
    canonical({
      schema: 'assay-lifecycle-error/0.1',
      status: 'ContextRequired',
      authority: 'NoVerificationGrant',
      reason: error.message,
      executed: false
    })
  );
  process.exitCode = 2;
}
