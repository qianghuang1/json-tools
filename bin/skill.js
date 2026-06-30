#!/usr/bin/env node

const { Command } = require('commander');
const { copySkillsFolder } = require('../dist/skill');

const program = new Command();

program
  .name('skill')
  .description('Manage packaged json-command-tools skills.');

program
  .command('copy')
  .description('Copy the packaged skills folder to a target folder.')
  .argument('[target]', 'folder that should receive a skills subfolder', process.cwd())
  .option('--source <path>', 'source skills folder to copy')
  .option('-f, --force', 'overwrite an existing target skills folder')
  .action(async (target, options) => {
    try {
      const result = await copySkillsFolder({
        targetDir: target,
        sourceDir: options.source,
        force: options.force,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message || String(error)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
