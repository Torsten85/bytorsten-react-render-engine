/* eslint-disable react/no-this-in-sfc */
import path from 'path';
import webpack from 'webpack';
import VirtualModulesPlugin from 'webpack-virtual-modules';
import UglifyJsPlugin from 'uglifyjs-webpack-plugin';
import MemoryFS from 'memory-fs';
import Processor from '@bytorsten/processor';
import merge from 'webpack-merge';

import { nodeModulesPath, isProduction } from '@bytorsten/helper';

const FAKE_BUNDLED_ROOT = '/bundled';
const FAKE_UNBUNDLED_ROOT = '/unbundled';

export default class Bundler {

  constructor({ file, baseBundle, publicPath, baseDirectory, aliases = {}, hypotheticalFiles = {}, externals = {} }) {

    this.file = path.basename(file);
    this.path = baseDirectory || path.dirname(file);
    this.publicPath = publicPath;
    this.baseBundle = baseBundle;
    this.hypotheticalFiles = hypotheticalFiles;
    this.aliases = aliases;
    this.externals = externals;

    let bundleNodeModulesPath = (baseDirectory || path.dirname(file)).replace(/\/$/, '');
    if (!bundleNodeModulesPath.endsWith('node_modules')) {
      bundleNodeModulesPath += '/node_modules';
    }

    this.nodeModulesPaths = [bundleNodeModulesPath, nodeModulesPath];

    for (const aliasPath of Object.values(aliases)) {
      const externalNodeModulePath = aliasPath.substring(0, aliasPath.indexOf('/node_modules')) + '/node_modules';
      if (!this.nodeModulesPaths.includes(externalNodeModulePath)) {
        this.nodeModulesPaths.push(externalNodeModulePath);
      }
    }
  }

  async buildConfig() {
    const virtualModules = Object.keys(this.baseBundle).reduce((modules, name) => {
      let { code, map } = this.baseBundle[name];

      if (map) {
        code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(map).toString('base64')}`;
      }

      modules[`${FAKE_UNBUNDLED_ROOT}/${name}`] = code;
      return modules;
    }, {});

    const config = {
      mode: isProduction() ? 'production' : 'development',
      bail: true,
      devtool: isProduction() ? null : 'cheap-module-source-map',
      entry: `${FAKE_UNBUNDLED_ROOT}/${this.file}`,
      output: {
        path: FAKE_BUNDLED_ROOT,
        filename: this.file,
        publicPath: this.publicPath,
        chunkFilename: '[id].js'
      },
      resolve: {
        alias: this.aliases,
        modules: this.nodeModulesPaths
      },
      externals: this.externals,
      plugins: [
        new VirtualModulesPlugin({
          ...virtualModules,
          ...this.hypotheticalFiles
        })
      ],
      module: {
        strictExportPresence: true,
        rules: [
          {
            include: FAKE_UNBUNDLED_ROOT,
            loader: require.resolve('source-map-loader'),
            enforce: 'pre'
          }
        ]
      },
      performance: false,
      optimization: {
        minimizer: isProduction() ? [
          new UglifyJsPlugin({
            uglifyOptions: {
              parse: {
                ecma: 8
              },
              compress: {
                ecma: 5,
                warnings: false,
                comparisons: false
              },
              mange: {
                safari10: true
              },
              output: {
                ecma: 5,
                comments: false,
                ascii_only: true
              }
            },

            parallel: true,
            cache: true,
            sourceMap: true
          })
        ] : []
      }
    };

    if (this.baseBundle['webpack.config.js']) {
      const processor = new Processor({ bundle: this.baseBundle, paths: this.nodeModulesPaths });
      const additionalConfiguration = await processor.process('webpack.config.js');
      return merge(config, additionalConfiguration);
    }

    return config;
  }

  async bundle() {

    const memoryFS = new MemoryFS();
    memoryFS.mkdirSync(FAKE_BUNDLED_ROOT);
    memoryFS.mkdirSync(FAKE_UNBUNDLED_ROOT);

    const compiler = webpack(await this.buildConfig());

    compiler.outputFileSystem = memoryFS;

    await new Promise((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) {
          return reject(error);
        }

        const { compilation: { errors, warnings } } = stats;

        if (errors.length > 0) {
          return reject(new Error(errors[0]));
        }

        if (warnings.length > 0) {
          return reject(new Error(warnings[0]));
        }

        resolve();
      });
    });

    const bundle = memoryFS.readdirSync(FAKE_BUNDLED_ROOT).reduce((bundle, filename) => {

      if (!/\.map$/.test(filename)) {

        let map;
        try {
          map = memoryFS.readFileSync(`${FAKE_BUNDLED_ROOT}/${filename}.map`, 'utf8');
        } catch (error) {
          map = null;
        }

        bundle[filename] = {
          code: memoryFS.readFileSync(`${FAKE_BUNDLED_ROOT}/${filename}`, 'utf8'),
          map
        };
      }

      return bundle;
    }, {});

    return { bundle };
  }
}
