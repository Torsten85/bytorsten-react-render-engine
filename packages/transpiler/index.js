import { rollup } from 'rollup';
import babel from 'rollup-plugin-babel';
import hypothetical from 'rollup-plugin-hypothetical';
import alias from 'rollup-plugin-alias';
import path from 'path';

import { stripBundle, fileExists, isProduction } from '@bytorsten/helper';

import BabelPresetReact from '@babel/preset-react';
import BabelRuntime from '@babel/plugin-transform-runtime';
import BabelObjectRestSpread from '@babel/plugin-proposal-object-rest-spread';
import BabelClassProperties from '@babel/plugin-proposal-class-properties';
import BabelReactInlineElement from '@babel/plugin-transform-react-inline-elements';
import BabelReactContantElements from '@babel/plugin-transform-react-constant-elements';
import BabelSyntaxDynamicImport from '@babel/plugin-syntax-dynamic-import';
import BabelSyntaxImportMeta from '@babel/plugin-syntax-import-meta';

import buildReactHelpers from './helpers';
import flowResource from './flowResource';
import privateResource from './privateResource';

export default class Transpiler {

  constructor({ serverFile, clientFile, helpers, aliases = {}, hypotheticalFiles = {}, rpc, baseDirectory }) {
    this.serverFile = serverFile;
    this.clientFile = clientFile;
    this.baseDirectory = baseDirectory || path.dirname(this.serverFile);
    this.helpers = helpers;
    this.hypotheticalFiles = hypotheticalFiles;
    this.aliases = aliases;
    this.resolvedPaths = {};
    this.dependencies = [];
    this.rpc = rpc;
  }

  async transpile() {

    const possibleWebpackConfiguration = path.join(this.baseDirectory, 'webpack.config.js');

    this.result = await rollup({
      input: [this.serverFile, this.clientFile, await fileExists(possibleWebpackConfiguration) ? possibleWebpackConfiguration : null].filter(Boolean),
      onwarn: ({ code, source, message, importer }) => {

        if (code === 'UNRESOLVED_IMPORT' && source[0] !== '.' && source[0] !== '/') {
          return;
        }

        if (code === 'CIRCULAR_DEPENDENCY' && importer === '@bytorsten/react') {
          return;
        }

        console.warn(message);
      },
      external: id => Object.keys(this.resolvedPaths).includes(id),
      experimentalCodeSplitting: true,
      plugins: [
        buildReactHelpers({
          helpers: this.helpers,
          baseDirectory: path.dirname(this.serverFile),
          addResolvedPath: (name, path) => this.resolvedPaths[name] = path,
          addDependency: path => this.dependencies.push(path)
        }),
        flowResource({ rpc: this.rpc }),
        privateResource({ rpc: this.rpc }),
        alias(this.aliases),
        hypothetical({
          allowFallthrough: true,
          leaveIdsAlone: true,
          files: this.hypotheticalFiles
        }),
        babel({
          runtimeHelpers: true,
          exclude: 'node_modules/**',
          cwd: this.baseDirectory,

          presets: [
            BabelPresetReact
          ],

          plugins: [
            BabelRuntime,
            BabelSyntaxDynamicImport,
            BabelSyntaxImportMeta,
            BabelObjectRestSpread,
            BabelClassProperties,
            isProduction() && BabelReactInlineElement,
            isProduction() && BabelReactContantElements
          ].filter(Boolean)
        })
      ]
    });

    const rawBundle = await this.result.generate({ format: 'es', sourcemap: !isProduction() });
    const bundle = stripBundle(rawBundle);

    return {
      bundle,
      resolvedPaths: this.resolvedPaths
    };
  }

  getDependencies() {
    return [
      ...this.dependencies,
      ...this.result.cache.modules.map(({ id }) => id).filter(id => id[0] === '/')
    ];
  }
}
