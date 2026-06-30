#!/usr/bin/env node

const { Command } = require('commander');
const { buildStorageDirectory } = require('../dist/storage');

const program = new Command();

program
  .name('build-storage')
  .description('Generate a directory.md table for schema-backed JSON storage files.')
  .option('-t, --target <path>', 'storage root to index (default: ~/.agent-storage)')
  .action(async (options) => {
    try {
      const result = await buildStorageDirectory({ targetDir: options.target });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message || String(error)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
