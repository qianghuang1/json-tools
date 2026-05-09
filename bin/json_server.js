#!/usr/bin/env node

const { Command } = require('commander');
const path = require('node:path');
const { startServer } = require('../dist/server');

const program = new Command();

program
  .name('json_server')
  .description('HTTP server that hosts JSON files (and their sibling schemas) under a root path using the JPQ protocol.');

program
  .command('start')
  .description('Start the HTTP server.')
  .requiredOption('-t, --target <path>', 'root directory to serve JSON files from')
  .option('-h, --host <host>', 'host to bind to', '127.0.0.1')
  .option('-p, --port <port>', 'port to listen on', '3000')
  .option('--token-file <path>', 'path to a JSON file with allowed access tokens (sha256-hashed)')
  .option('--no-cors', 'disable CORS headers')
  .option('--quiet', 'disable request logging')
  .action(async (options) => {
    try {
      const rootDir = path.resolve(options.target);
      const port = Number.parseInt(options.port, 10);
      if (!Number.isFinite(port)) {
        throw new Error(`Invalid port: ${options.port}`);
      }
      const { address } = await startServer({
        rootDir,
        host: options.host,
        port,
        logger: !options.quiet,
        cors: options.cors,
        tokenFilePath: options.tokenFile,
      });
      const authNote = options.tokenFile ? ' (token auth enabled)' : ' (no auth)';
      process.stdout.write(`json_server listening on ${address} (root: ${rootDir})${authNote}\n`);
    } catch (error) {
      process.stderr.write(`${error.message || String(error)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
