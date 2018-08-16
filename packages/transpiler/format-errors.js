const errorLabel = 'Syntax error:';
const isLikelyASyntaxError = str => str.includes(errorLabel);

const exportRegex = /\s*(.+?)\s*(")?export '(.+?)' was not found in '(.+?)'/;
const stackRegex = /^\s*at\s((?!webpack:).)*:\d+:\d+[\s)]*(\n|$)/gm;

function formatMessage(message) {
  let lines = message.split('\n');

  if (lines.length > 2 && lines[1] === '') {
    lines.splice(1, 1);
  }

  if (lines[0].lastIndexOf('!') !== -1) {
    lines[0] = lines[0].substr(lines[0].lastIndexOf('!') + 1);
  }

  lines = lines.filter(line => line.indexOf(' @ ') !== 0);

  if (!lines[0] || !lines[1]) {
    return lines.join('\n');
  }

  if (lines[1].startsWith('Module not found: ')) {
    lines = [
      lines[0],
      lines[1]
        .replace("Cannot resolve 'file' or 'directory' ", '')
        .replace('Cannot resolve module ', '')
        .replace('Error: ', '')
        .replace('[CaseSensitivePathsPlugin] ', '')
    ];
  }

  if (lines[1].startsWith('Module build failed: ')) {
    lines[1] = lines[1].replace('Module build failed: SyntaxError:', errorLabel);
  }

  if (lines[1].match(exportRegex)) {
    lines[1] = lines[1].replace(exportRegex, "$1 '$4' does not contain an export named '$3'.");
  }

  return lines.join('\n').replace(stackRegex, '').trim();
}

export default function (stats) {
  const json = stats.toJson({}, true);

  const result = {
    errors: json.errors.map(msg => formatMessage(msg, true)),
    warnings: json.warnings.map(msg => formatMessage(msg, false))
  };

  if (result.errors.some(isLikelyASyntaxError)) {
    result.errors = result.errors.filter(isLikelyASyntaxError);
  }

  if (result.errors.length > 1) {
    result.errors.length = 1;
  }

  return result;
}
