#!/usr/bin/env node

const { Command } = require('commander');
const { readJsonFile, readJsonFileWithSchema } = require('../src/read-json');

const program = new Command();

function parseInlineParameters(parameterValues = []) {
  return parameterValues.map((parameterValue) => {
    try {
      return JSON.parse(parameterValue);
    } catch {
      throw new Error(`Invalid JSON passed to --parameter: ${parameterValue}`);
    }
  });
}

program
  .name('read_json')
  .description('Read a JSON file with schema-first output and optional array paging and sorting.')
  .requiredOption('-t, --target <path>', 'path to the JSON file to read')
  .option('--parameter <json...>', 'one or more inline JSON parameter objects')
  .option('-p, --parameter-path <paths...>', 'path(s) to JSON files containing read options')
  .option('-a, --all', 'read the whole JSON document without truncating arrays')
  .action(async (options) => {
    try {
      if (options.all) {
        if (options.parameter || options.parameterPath) {
          throw new Error('--all cannot be combined with parameter filters');
        }

        const result = await readJsonFile({
          targetPath: options.target,
          includeAll: true,
        });

        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      const result = await readJsonFileWithSchema({
        targetPath: options.target,
        parameters: parseInlineParameters(options.parameter),
        parameterPaths: options.parameterPath || [],
      });

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);