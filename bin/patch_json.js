#!/usr/bin/env node

const { Command } = require('commander');
const { patchJsonFile } = require('../src/patch-json');

const program = new Command();

program
  .name('patch_json')
  .description('Apply a JSON Patch file to a target JSON document.')
  .requiredOption('-t, --target <path>', 'path to the target JSON file')
  .requiredOption('-s, --source <path>', 'path to the JSON Patch file')
  .action(async (options) => {
    try {
      const result = await patchJsonFile({
        targetPath: options.target,
        patchPath: options.source,
      });

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);