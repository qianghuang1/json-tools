#!/usr/bin/env node

const { Command } = require('commander');
const { patchJsonFile } = require('../dist/patch-json');

const program = new Command();

program
  .name('patch_json')
  .description('Apply a JSON Patch to a target JSON document from a file or inline JSON.')
  .requiredOption('-t, --target <path>', 'path to the target JSON file')
  .option('-s, --source <path>', 'path to the JSON Patch file')
  .option('-i, --inline <json>', 'inline JSON Patch document')
  .action(async (options) => {
    try {
      if (!options.source && !options.inline) {
        throw new Error('Either --source or --inline must be provided');
      }

      if (options.source && options.inline) {
        throw new Error('Use either --source or --inline, not both');
      }

      const result = await patchJsonFile({
        targetPath: options.target,
        patchPath: options.source,
        patchContent: options.inline,
      });

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);