import fs from 'fs';
import path from 'path';
import resolveRequire from 'resolve';

export const rootPath = path.resolve(__dirname, '..');
export const staticPath = path.join(rootPath, 'static');
export const nodeModulesPath = path.join(rootPath, 'node_modules');

export const isProduction = () => process.env.NODE_ENV === 'production';
export const stripBundle = bundle => Object.keys(bundle.output).reduce((strippedBundle, filename) => {
  const { code, map } = bundle.output[filename];

  strippedBundle[filename] = {
    code,
    map: map ? map.toString() : null
  };

  return strippedBundle;
}, {});

export const loadFile = filename => new Promise((resolve, reject) => {
  fs.readFile(filename, 'utf8', (error, content) => {
    if (error) {
      reject(error);
    } else {
      resolve(content);
    }
  });
});

export const fileExists = filename => new Promise(resolve => {
  fs.access(filename, fs.constants.F_OK, error => resolve(!error));
});

export const resolveModule = (name, options) => new Promise(resolve => {
  resolveRequire(name, options, (error, result) => {
    if (error) {
      resolve(null);
    } else {
      resolve(result);
    }
  });
});

export const getModuleVersion = (name, options = {}) => new Promise(resolve => {

  let version = null;
  options.packageFilter = pkg => {
    version = pkg.version || null;
    return pkg;
  };

  resolveRequire(name, options, () => {
    resolve(version);
  });
});
