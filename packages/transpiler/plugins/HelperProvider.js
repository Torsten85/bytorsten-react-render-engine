import { fileExists, loadFile, waitFor } from '@bytorsten/helper';
import path from 'path';
import fs from 'fs';

const EXTENSION_KEY = '__extension';

const realPath = path => waitFor(c => fs.realpath(path, c));

export default class HelperProvider {

  constructor({ helpers, baseFolder, modules }) {
    this.helpers = helpers;
    this.baseFolder = baseFolder;
    this.otherModuleRoots = modules;
    this.helperNames = Object.keys(helpers);
  }

  toFilename(packageName) {
    return `${this.baseFolder}/${packageName}/index.js`;
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
        return { filename: configuration[EXTENSION_KEY] };
      }
    }

    let content;
    if (configuration[EXTENSION_KEY]) {
      content = await loadFile(configuration[EXTENSION_KEY]);
    } else {
      content = '';
    }

    content += (`\nexport { ${dynamicHelper.join(', ')} } from '${helper}/_rpc';`);

    const filename = configuration[EXTENSION_KEY] ? await realPath(configuration[EXTENSION_KEY]) : this.toFilename(helper);
    return { filename, content };
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

  getResolversForPath(lookupPath) {
    const resolver = Object.keys(this.helperResolvers).find(p => lookupPath.startsWith(p));
    if (!resolver) {
      return [];
    }

    return [
      ...this.rootResolvers,
      resolver
    ];
  }

  async handle(filename) {
    const helper = this.helperNames.find(helperName => filename.startsWith(helperName) && ['/', ''].includes(filename.substr(helperName.length, 1)));

    if (helper) {
      const subPath = filename.substring(helper.length + 1);
      return this.generateModule(helper, subPath);
    }
  }
}
