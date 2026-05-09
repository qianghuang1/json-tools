#!/usr/bin/env node

const { Command } = require('commander');
const { readJsonFile } = require('../dist/read-json');
const { ValidationError } = require('../dist/core/validate');

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
  .description('Read a JSON file using the JPQ protocol (see docs/jpq-protocol.md).')
  .requiredOption('-t, --target <path>', 'path to the JSON file to read')
  .option('--parameter <json...>', 'one or more inline JSON JPQ operation objects')
  .option('-p, --parameter-path <paths...>', 'path(s) to JSON files containing JPQ operation arrays')
  .option('-a, --all', 'return the entire document untouched (no truncation, no $array_index)')
  .action(async (options) => {
    try {
      if (options.all) {
        if (options.parameter || options.parameterPath) {
          throw new Error('--all cannot be combined with parameter filters');
        }
        const result = await readJsonFile({ targetPath: options.target, includeAll: true });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      const result = await readJsonFile({
        targetPath: options.target,
        parameters: parseInlineParameters(options.parameter),
        parameterPaths: options.parameterPath || [],
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      if (error instanceof ValidationError) {
        process.stderr.write(`${error.message}\n`);
      } else {
        process.stderr.write(`${error.message || String(error)}\n`);
      }
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);