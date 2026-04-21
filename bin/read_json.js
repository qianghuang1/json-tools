#!/usr/bin/env node

const { Command } = require('commander');
const { readJsonFile } = require('../src/read-json');

const program = new Command();

program
  .name('read_json')
  .description('Read a JSON file with optional array paging and sorting.')
  .requiredOption('-t, --target <path>', 'path to the target JSON file')
  .option('-p, --parameter <path>', 'path to the JSON file containing read options')
  .option('-a, --all', 'read the whole JSON document without truncating arrays')
  .action(async (options) => {
    try {
      const result = await readJsonFile({
        targetPath: options.target,
        parameterPath: options.parameter,
        includeAll: Boolean(options.all),
      });

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);