/* eslint-disable react/no-this-in-sfc */
import path from 'path';
import { rollup } from 'rollup';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import replace from 'rollup-plugin-replace';
import alias from 'rollup-plugin-alias';
import { terser } from 'rollup-plugin-terser';
import hypothetical from 'rollup-plugin-hypothetical';
import namedExports from 'rollup-plugin-named-exports';
import { stripBundle, nodeModulesPath, isProduction, resolveModule, getModuleVersion } from '@bytorsten/helper';
import semverDiff from 'semver-diff';

export default class Bundler {

  constructor({ file, baseBundle, chunkPath, baseDirectory, aliases = {}, hypotheticalFiles = {} }) {
    this.file = path.basename(file);
    this.path = baseDirectory || path.dirname(file);
    this.chunkPath = chunkPath;
    this.baseBundle = baseBundle;
    this.hypotheticalFiles = hypotheticalFiles;
    this.aliases = aliases;
    this.paths = [nodeModulesPath];

    this.externalNodeModulePaths = [];
    for (const aliasPath of Object.values(aliases)) {
      const externalNodeModulePath = aliasPath.substring(0, aliasPath.indexOf('/node_modules')) + '/node_modules';
      if (!~this.externalNodeModulePaths.indexOf(externalNodeModulePath)) {
        this.externalNodeModulePaths.push(externalNodeModulePath);
      }
    }
  }

  updateConfig(config) {

    const bundleFiles = Object.keys(this.baseBundle).reduce((files, key) => {
      files[`./${key}`] = this.baseBundle[key];
      return files;
    }, {});

    config.plugins[1] = hypothetical({
      allowFallthrough: true,
      leaveIdsAlone: true,
      files: { ...bundleFiles, ...this.hypotheticalFiles }
    });

    return config;
  }

  resolveSubModulesFromHelper() {

    const resolvedSubModules = {};

    return {
      resolveId: async (importee, importer) => {
        if (/\0/.test(importee) || importee[0] === '.') {
          return null;
        }

        for (const externalNodeModulePath of this.externalNodeModulePaths) {
          if (importer.indexOf(externalNodeModulePath) === 0) {

            const identifier = importee + externalNodeModulePath;
            if (typeof resolvedSubModules[identifier] !== 'undefined') {
              return resolvedSubModules[identifier];
            }

            const version = await getModuleVersion(importee, { basedir: externalNodeModulePath });

            if (version === null) {
              return resolvedSubModules[identifier] = null;
            }

            const parentVersion = await getModuleVersion(importee, { basedir: this.path, paths: this.paths });

            if (parentVersion) {
              const diff = semverDiff(version, parentVersion);

              // we already have a module for that
              if (diff === null || diff === 'patch' || diff === 'minor') {
                return resolvedSubModules[identifier] = null;
              }
            }

            return resolvedSubModules[identifier] = await resolveModule(importee, { basedir: externalNodeModulePath });
          }
        }

        return null;
      }
    };
  }

  buildConfig() {
    return this.updateConfig({
      input: `./${this.file}`,
      cache: null,
      experimentalCodeSplitting: true,
      onwarn: ({ message, loc }) => {
        if (loc) {
          console.log(`${loc.file} (${loc.line}:${loc.column})}: ${message}`); // eslint-disable-line no-console
        } else {
          console.log(message, ); // eslint-disable-line no-console
        }

      },
      plugins: [
        alias(this.aliases),
        {}, // hypothetical
        this.resolveSubModulesFromHelper(),
        resolve({
          extensions: [ '.js', '.json' ],
          browser: true,
          preferBuiltins: false,
          customResolveOptions: {
            basedir: this.path,
            paths: this.paths
          }
        }),
        namedExports(),
        commonjs({
          sourceMap: !isProduction(),
          extensions: [ '.js', '' ] // allow files without extensions like the one from hypothetical
        }),
        replace({
          'process.env.SSR': false,
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV)
        }),

        isProduction() && terser({
          toplevel: true
        })
      ]
    });
  }

  async bundle({ legacy = false, cache = null } = {}) {

    let config;
    if (cache) {
      config = this.updateConfig(cache);
    } else {
      config = this.buildConfig();
    }

    const result = await rollup(config);
    config.cache = result.cache;

    const format = legacy ? 'system' : 'es';
    const bundle = stripBundle(await result.generate({
      format,
      sourcemap: !isProduction()
    }));

    return {
      cache: config,
      bundle: bundle
    };
  }
}
