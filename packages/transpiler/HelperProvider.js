import { fileExists, loadFile } from '@bytorsten/helper';
import MagicString from 'magic-string';
import path from 'path';
import crypto from 'crypto';

const EXTENSION_KEY = '__extension';

export default class HelperProvider {

  constructor({ helpers, baseFolder }) {
    this.helpers = helpers;
    this.baseFolder = baseFolder;
    this.knownHashes = {};
    this.helperNames = Object.keys(this.helpers);
  }

  toFilename(packageName) {
    const packageHash = crypto.createHash('md5').update(packageName).digest('hex');
    this.knownHashes[packageHash] = packageName;
    return `${this.baseFolder}/${packageHash}/index.js`;
  }

  async generateModule(helper, subPath) {
    if (subPath === '_rpc') {
      return this.generateRpcHelperModule(helper);
    } else if (subPath) {
      return this.generateSubHelperModule(helper, subPath);
    } else {
      return this.generateHelperModule(helper);
    }
  }

  async generateRpcHelperModule(helper) {
    const configuration = this.helpers[helper];
    const dynamicHelper = Object.keys(configuration).filter(helperName => helperName !== EXTENSION_KEY && configuration[helperName] === true);

    const code = [`
      import React from 'react';
      import { Rpc } from '@bytorsten/react';
    `];

    const helperTemplate = `
      export const %EXPORT_NAME% = ({ children, forceFetch, ...variables }) => (
        <Rpc helper="%MODULE_NAME%.%EXPORT_NAME%" variables={variables} forceFetch={forceFetch}>
          {children}
        </Rpc>
      );
    `;

    code.push(...dynamicHelper.map(dynamicHelperName => helperTemplate
      .replace(/%MODULE_NAME%/g, helper)
      .replace(/%EXPORT_NAME%/g, dynamicHelperName)
    ));

    return { filename: this.toFilename(`${helper}_rpc`), content: code.join('\n') };
  }

  async generateHelperModule(helper) {
    const configuration = this.helpers[helper];
    const dynamicHelper = Object.keys(configuration).filter(helperName => helperName !== EXTENSION_KEY && configuration[helperName] === true);

    if (dynamicHelper.length === 0) {
      if (configuration[EXTENSION_KEY]) {
        return configuration[EXTENSION_KEY];
      }
    }

    let code;
    if (configuration[EXTENSION_KEY]) {
      code = new MagicString(await loadFile(configuration[EXTENSION_KEY]));
      code.append('\n');
    } else {
      code = new MagicString('');
    }

    code.append(`export { ${dynamicHelper.join(', ')} } from '${helper}/_rpc';`);
    const filename = this.toFilename(helper);
    const map = code.generateMap({
      file: filename,
      source: configuration[EXTENSION_KEY] || null,
      hires: true
    });

    return { filename, content: `${code.toString()}\n//# sourceMappingURL=${map.toUrl()}` };
  }

  async generateSubHelperModule(helper, subPath) {
    const configuration = this.helpers[helper];
    if (!configuration[EXTENSION_KEY]) {
      throw new Error(`Cannot generate sub helper module ${subPath} for ${helper}, no main extension file is configured`);
    }

    const dirname = path.dirname(configuration[EXTENSION_KEY]);
    const resolvedSubPath = path.join(dirname, `${subPath}.js`);

    if(! await fileExists(resolvedSubPath)) {
      throw new Error(`Cannot generate sub helper module ${subPath} for ${helper}, file ${resolvedSubPath} does not exist`);
    }

    return { filename: resolvedSubPath };
  }

  async handle(filename, requestPath) {
    const helper = this.helperNames.find(helperName => filename.startsWith(helperName));
    if (helper) {
      const subPath = filename.substring(helper.length + 1);
      return this.generateModule(helper, subPath);
    } else if (requestPath.startsWith(this.baseFolder)) {
      const packageHash = requestPath.substr(this.baseFolder.length + 1, 32);
      const helperName = this.knownHashes[packageHash];
      if (helperName) {
        const configuartion = this.helpers[helperName];
        if (configuartion && configuartion[EXTENSION_KEY]) {
          const resolvedFilename = path.join(path.dirname(configuartion[EXTENSION_KEY]), `${filename}.js`);
          if (await fileExists(resolvedFilename)) {
            return { filename: resolvedFilename };
          }
        }
      }
    }
  }
}
