const { execFile } = require('child_process');
const path = require('path');

const pythonExecutable = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'ml-service',
  '.venv',
  'Scripts',
  'python.exe'
);
const predictor = path.join(__dirname, '..', '..', '..', 'ml-service', 'predict.py');

function clean(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function jaro(first, second) {
  if (first === second) return 1;
  if (!first.length || !second.length) return 0;
  const distance = Math.floor(Math.max(first.length, second.length) / 2) - 1;
  const firstMatches = new Array(first.length).fill(false);
  const secondMatches = new Array(second.length).fill(false);
  let matches = 0;

  for (let index = 0; index < first.length; index += 1) {
    const start = Math.max(0, index - distance);
    const end = Math.min(index + distance + 1, second.length);
    for (let candidate = start; candidate < end; candidate += 1) {
      if (!secondMatches[candidate] && first[index] === second[candidate]) {
        firstMatches[index] = true;
        secondMatches[candidate] = true;
        matches += 1;
        break;
      }
    }
  }

  if (!matches) return 0;
  let transpositions = 0;
  let secondIndex = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (!firstMatches[index]) continue;
    while (!secondMatches[secondIndex]) secondIndex += 1;
    if (first[index] !== second[secondIndex]) transpositions += 1;
    secondIndex += 1;
  }
  return (matches / first.length + matches / second.length + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(first, second) {
  const left = clean(first);
  const right = clean(second);
  const base = jaro(left, right);
  let prefix = 0;
  while (prefix < Math.min(4, left.length, right.length) && left[prefix] === right[prefix]) prefix += 1;
  return base + prefix * 0.1 * (1 - base);
}

function checkDuplicate(features) {
  return checkDuplicates([features]).then((results) => results[0]);
}

function checkDuplicates(features) {
  return new Promise((resolve, reject) => {
    const child = execFile(pythonExecutable, [predictor], { windowsHide: true }, (error, stdout) => {
      if (error) return reject(error);
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) return reject(new Error(result.error));
        resolve(Array.isArray(result) ? result : [result]);
      } catch (parseError) {
        reject(parseError);
      }
    });
    child.stdin.end(JSON.stringify(features));
  });
}

module.exports = { checkDuplicate, checkDuplicates, jaroWinkler };
