#!/usr/bin/env node
const program = require('commander');
const chalk = require('chalk');
const fs = require('fs');
const xmlParser = require('xml-parser');
const inspect = require('util').inspect;

program
  .option('-d, --dir <dir>', 'The dir where the .xcdatamodel is located', '.')
  .option('-m, --model <modelname>', 'The name of the model without extension', 'Model')
  .option('-v, --verbose', 'Show more info')
  .option('--debug', 'Show debug info')
  .action(function() {
    if (program.debug) {
      program.verbose = true;
    }
    run()
  })
  .parse(process.argv);

function run() {
  log(chalk.bold('Running xcdatamodel'));
  log(`dir: ${chalk.bold(program.dir)}`);
  log(`model: ${chalk.bold(program.model)}.xcdatamodeld`);
  const versions = getVersions()
  log(`versions:`);
  if (versions.length == 0) {
    exitWithError(chalk.bold.red(`No versions found in '${getModelDir()}'`));
  }
  for (var i = 0; i < versions.length; i++) {
    const version = versions[i]
    log(chalk.bold(`\t${version.number}: ${version.dir}`));
  }
  loadModelVersions(versions);
  const reports = analyzeVersions(versions);
  processProblems(reports);
  showResults(reports);
}

function analyzeVersions(versions) {
  const reports = []
  for (var i = 1; i < versions.length; i++) {
    const oldVersion = versions[i-1];
    const newVersion = versions[i];
    const report = {
      from: oldVersion.number,
      to: newVersion.number,
      problems: []
    }
    analyzeMigrationEntities(report, oldVersion, newVersion);
    reports.push(report);
  }
  return reports;
}

function analyzeMigrationEntities(report, oldVersion, newVersion) {
  logV(`Analyzing migration ${oldVersion.number} -> ${newVersion.number}`);
  for (var i = 0; i < oldVersion.model.entities.length; i++) {
    const oldEntity = oldVersion.model.entities[i];
    const newEntity = findEntityByName(newVersion, oldEntity.name);
    if (newEntity) {
      analyzeMigrationFields(report, oldEntity, newEntity);
    } else {
      debug(chalk.bold.yellow(`Entity '${oldEntity.name}' is missing`));
      report.problems.push({
        entity: oldEntity.name,
        type: 'missing'
      });
    }
  }
}

function analyzeMigrationFields(report, oldEntity, newEntity) {
  logV(`Analyzing entity ${oldEntity.name}`);
  for (var i = 0; i < oldEntity.fields.length; i++) {
    const oldField = oldEntity.fields[i];
    const newField = findFieldByName(newEntity, oldField.name);
    if (newField) {
      //TODO: CHECK IF CHANGED!!
      analyzeMigrationFieldsAttrs(report, oldEntity, oldField, newField);
    } else {
      debug(chalk.bold.yellow(`Field '${oldField.name}' from ${oldEntity.name} is missing`));
      report.problems.push({
        entity: oldEntity.name,
        field: oldField.name,
        type: 'missing'
      });
    }
  }
}

function analyzeMigrationFieldsAttrs(report, oldEntity, oldField, newField) {
  logV(`Analyzing field ${oldField.name}`);
  var keys = Object.keys(oldField);
  for (var i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (oldField[key] !== newField[key]) {
      debug(chalk.bold.yellow(`Field '${oldField.name}' from ${oldEntity.name} was changed`));
      report.problems.push({
        entity: oldEntity.name,
        field: oldField.name,
        attr: key,
        from: oldField[key],
        to: newField[key],
        type: 'changed'
      });
    }
  }
}

function findEntityByName(version, name) {
  for (var i = 0; i < version.model.entities.length; i++) {
    const entity = version.model.entities[i];
    if (entity.name === name) {
      return entity;
    }
  }
  return false;
}

function findFieldByName(entity, name) {
  for (var i = 0; i < entity.fields.length; i++) {
    const field = entity.fields[i];
    //debug(entity.name + ' === ' + name + ' ==>> ' + (entity.name === name));
    if (field.name === name) {
      return field;
    }
  }
  return false;
}

function loadModelVersions(versions) {
  for (var i = 0; i < versions.length; i++) {
    const version = versions[i];
    version.model = readModelVersion(version);
  }
}

function readModelVersion(version) {
  logV(`Loading version ${version.number} from '${version.dir}'`);
  const xmlData = fs.readFileSync(`${version.dir}/contents`, 'utf8');

  logV(`Parsing...`);
  const data = xmlParser(xmlData);

  const model = {
    version: version.number,
    entities: []
  };

  const elements = data.root.children;
  for (var i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.name === 'entity') {
        logV(`${element.name}: ${element.attributes.name}`);
        const entity = {
          name: element.attributes.name,
          fields: []
        };
        readEntity(entity, element)
        model.entities.push(entity);
    } else if (element.name === 'elements') {
        logV(`element '${element.name}' is ignored`);
    } else {
        warn(chalk.bold.yellow(`Unknow type ${element.name}`));
    }
  }

  return model;
}

function readEntity(entity, element) {
    const elementFields = element.children;
    for (var i = 0; i < elementFields.length; i++) {
      const elementField = elementFields[i];
      if (elementField.name === 'attribute' || elementField.name === 'relationship') {
          logV(`\t${elementField.name}: ${elementField.attributes.name}`);
          entity.fields.push(elementField.attributes)
      } else {
          warn(chalk.bold.yellow(`\tUnknow type ${elementField.name}`));
          debug(`\t${inspect(elementField, { colors: true, depth: Infinity })}`);
      }
  }
}

function getVersions() {
  const versions = [];
  var version = 0;
  while (fs.existsSync(getVersionDir(++version))) {
    versions.push({
      number: version,
      dir: getVersionDir(version)
    });
  }
  return versions;
}

function getVersionDir(version) {
  var sufix = '';
  if (version > 1) {
    sufix = ' ' + version;
  }
  return `${getModelDir()}/${program.model}${sufix}.xcdatamodel`;
}

function getModelDir() {
  return `${program.dir}/${program.model}.xcdatamodeld`;
}

function getSolvedFile() {
  return `${program.dir}/${program.model}.solved`;
}

function exitWithError(msg) {
  error(msg);
  process.exit(-1);
}

function log(msg, type, verbose) {
  if (verbose && !program.verbose) {
    return;
  }
  if (type === 'e') {
    console.error(msg);
  } else if (type === 'w') {
    console.warn(msg);
  } else if (type === 'i') {
    console.warn(msg);
  } else {
    console.log(msg);
  }
}

function logV(msg, type) {
  log(msg, type, true);
}

function error(msg, verbose) {
  log(msg, 'e', verbose);
}

function warn(msg, verbose) {
  log(msg, 'w', verbose);
}

function debug(msg) {
  if (program.debug) {
    log(msg);
  }
}

function showResults(reports) {
  var success = true;
  for (var i = 0; i < reports.length; i++) {
    if (!showResultForVersion(reports[i])) {
      success = false;
    }
  }
  if (success) {
    log('Everything is OK');
  } else {
    log('');
    error(chalk.bold.red(`Problems found, check the erros below`));
    log(chalk.bold(`Check, test and solve the problems, before you can add the keys to the ignore file of the model`));
    exitWithError(chalk.bold.red(`The migration can fail! Test your app!!`));
  }
}

function showResultForVersion(report) {
  var success = true;
  for (var i = 0; i < report.problems.length; i++) {
    const problem = report.problems[i];
    if (!problem.solved) {
      success = false;
      log('');
      error(chalk.bold.red(problem.detail));
      log(`Key: ${chalk.bold(problem.key)}`);
    }
  }
  return success;
}

function processProblems(reports) {
  var keys = [];
  if (fs.existsSync(getSolvedFile())) {
    keys = fs.readFileSync(getSolvedFile(), 'utf8').split('\n');
  } else {
    warn(chalk.bold.yellow(`No solved file found: ${getSolvedFile()}`));
  }
  for (var i = 0; i < reports.length; i++) {
    const report = reports[i];
    for (var j = 0; j < report.problems.length; j++) {
      const problem = report.problems[j];
      problem.detail = detailProblem(report, problem);
      problem.key = solveProblem(report, problem);
      problem.solved = keys.indexOf(problem.key) > -1;
    }
  }
}

function detailProblem(report, problem) {
  var msg = `In version ${report.to}`;
  if (problem.field) {
    msg += ` the field ${problem.entity}.${problem.field}`;
  } else {
    msg += ` the entity ${problem.entity}`;
  }
  if (problem.type === 'missing') {
    msg += ` is missing`;
  } else if (problem.type === 'changed') {
    msg += ` was changed: ${problem.attr} from '${problem.from}' to '${problem.to}'`;
  }
  return msg;
}

function solveProblem(report, problem) {
  var cmd = `solved.${report.to}`;
  if (problem.field) {
    cmd += `.field.${problem.entity}.${problem.field}`;
  } else {
    cmd += `.entity.${problem.entity}`;
  }
  if (problem.type === 'missing') {
    cmd += '.missing'
  } else if (problem.type === 'changed') {
    cmd += '.changed'
  }
  return cmd;
}
