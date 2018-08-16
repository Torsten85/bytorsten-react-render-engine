import { isProduction, nodeModulesPath, fileExists } from '@bytorsten/helper';
import path from 'path';
import webpack from 'webpack';
import fs from 'fs';

import merge from 'webpack-merge';
import MemoryFS from 'memory-fs';

import formatErrors from './format-errors';
import VirtualModules from './plugins/VirtualModules';
import HelperProvider from './plugins/HelperProvider';
import FlowResourceProvider from './plugins/FlowResourceProvider';
import hypotheticalFilesProvider from './plugins/HypotheticalFilesProvider';
import ResourceLoader from './loader/ResourceLoader';

const FAKE_BUNDLED_ROOT = '/__bundled';
const FAKE_HELPER_ROOT = '/__helpers';

export default class Transpiler {
  constructor({ helpers, hypotheticalFiles, aliases, rpc }) {
    this.aliases = aliases;
    this.rpc = rpc;
    this.helpers = helpers;
    this.hypotheticalFiles = hypotheticalFiles;
    this.additionalDependencies = new Set();
    this.excluded = {};
  }

  filterExternalModules(context, request, callback) {

    if (this.excluded[request]) {
      return callback(null, `commonjs ${this.excluded[request]}`);
    }

    if (
      request[0] !== '.' &&
      request[0] !== '/' &&
      !request.startsWith('resource://') &&
      !(this.aliases && this.aliases[request]) &&
      !(this.hypotheticalFiles && this.hypotheticalFiles[request])
    ) {

      const isHelper = !!Object.keys(this.helpers).find(helperName => request.startsWith(helperName));
      if (!isHelper) {
        return this.resolver.resolve({}, context, request, {}, (error, filepath) => {
          if (error) {
            return callback();
          }

          this.excluded[request] = filepath;
          return callback(null, `commonjs ${filepath}`);
        });
      }
    }

    callback();
  }

  getOrderedChunks(stats) {
    const chunkOnlyConfig = {
      assets: false,
      cached: false,
      children: false,
      chunks: true,
      chunkModules: false,
      chunkOrigins: false,
      errorDetails: false,
      hash: false,
      modules: false,
      reasons: false,
      source: false,
      timings: false,
      version: false
    };

    return stats.toJson(chunkOnlyConfig).chunks.sort((a, b) => {
      if (a.entry !== b.entry) {
        return b.entry ? 1: - 1;
      }
      return b.id - a.id;
    });
  }

  async buildConfig({ file, target, publicPath, baseDirectory, externals }) {
    const base = path.join(baseDirectory || path.dirname(file));


    const possibleBabelRc = path.join(base, '.babelrc');
    let babelrc;
    if (await fileExists(possibleBabelRc)) {
      babelrc = possibleBabelRc;
      this.additionalDependencies.add(babelrc);
    }

    externals = externals || [];

    const config = {
      mode: target === 'web' && isProduction() ? 'production' : 'development',
      bail: true,
      devtool: isProduction() ? null : 'cheap-module-source-map',
      entry: file,
      externals: [
        target === 'node' && this.filterExternalModules.bind(this),
        ...externals
      ].filter(Boolean),
      output: {
        path: FAKE_BUNDLED_ROOT,
        filename: 'bundle.js',
        chunkFilename: '[name].chunk.js',
        devtoolModuleFilenameTemplate: '[resource-path]',
        publicPath
      },
      resolve: {
        mainFields: target === 'node' ? ['main'] : undefined,
        modules: [
          path.join(base, 'node_modules'),
          'node_modules',
          nodeModulesPath
        ],
        alias: this.aliases
      },
      target,
      plugins: [
        new VirtualModules({
          target,
          providers: [
            new FlowResourceProvider({ rpc: () => this.rpc }),
            new hypotheticalFilesProvider(this.hypotheticalFiles),
            new HelperProvider({
              helpers: this.helpers,
              baseFolder: FAKE_HELPER_ROOT
            })
          ]
        }),
        {
          apply: compiler => {
            compiler.resolverFactory.hooks.resolver.tap('normal', 'VirtualModules', resolver => {
              this.resolver = resolver;
            });
          }
        }
      ],
      module: {
        strictExportPresence: true,
        rules: [
          {
            exclude: [/[/\\\\]node_modules[/\\\\]/],
            loader: require.resolve('source-map-loader'),
            enforce: 'pre'
          },
          {
            oneOf: [
              {
                test: [/\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/, /\.css$/],
                loader: path.resolve(path.join(__dirname, './ResourceLoader')),
                options: {
                  rpc: () => this.rpc
                }
              },
              {
                test: /\.(js|jsx|mjs)$/,
                exclude: [/[/\\\\]node_modules[/\\\\]/],
                use: [
                  {
                    loader: require.resolve('babel-loader'),
                    options: {
                      babelrc: true,
                      extends: babelrc,
                      presets: [
                        '@babel/preset-react'
                      ].map(require.resolve),
                      plugins: [
                        '@babel/plugin-proposal-object-rest-spread',
                        '@babel/plugin-proposal-class-properties',
                        '@babel/plugin-syntax-dynamic-import'
                      ].map(require.resolve),
                      cacheDirectory: true,
                      highlightCode: true
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const possibleWebpackConfig = path.join(base, 'webpack.config.js');
    if (await fileExists(possibleWebpackConfig)) {
      this.additionalDependencies.add(possibleWebpackConfig);
      const extensionConfig = require(possibleWebpackConfig); // eslint-disable-line import/no-dynamic-require
      return merge(config, extensionConfig);
    }

    return config;
  }

  async transpile({ cache, file, target, publicPath, baseDirectory, externals } = {}) {

    const config = await this.buildConfig({ file, target, publicPath, baseDirectory, externals });
    config.cache = cache;

    const memoryFS = new MemoryFS();
    memoryFS.mkdirSync(FAKE_BUNDLED_ROOT);

    const compiler = webpack(config);
    this.compiler = compiler;
    compiler.outputFileSystem = memoryFS;

    const stats = await new Promise((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) {
          return reject(error);
        }

        const messages = formatErrors(stats);

        if (messages.errors.length > 0) {
          return reject(messages.errors[0]);
        }

        if (messages.warnings.length > 0) {
          messages.warnings.forEach(warning => console.log(warning)); // eslint-disable-line no-console
        }

        resolve(stats);
      });
    });

    fs.writeFileSync(`/tmp/stats-${target}.json`, JSON.stringify(stats.toJson()));

    this.stats = stats;
    const chunks = this.getOrderedChunks(stats);

    const { assets } = stats.compilation;

    const bundle = chunks.reduce((bundle, chunk, order) => {
      const chunkName = chunk.names[0];
      if (!chunkName) {
        return bundle;
      }

      const entry = {
        initial: typeof chunk.isInitial === 'function' ? chunk.isInitial() : chunk.initial,
        order
      };

      chunk.files.forEach(filename => {
        if (filename.endsWith('.map')) {
          entry.map = assets[filename].source();
        } else {
          bundle[filename] = entry;
          entry.code = assets[filename].source();
        }
      });
      return bundle;
    }, {});

    return { bundle, cache: stats.compilation.cache, excluded: this.excluded };
  }

  getDependencies() {
    const { modules } = this.stats.compilation;

    return modules
      .filter(({ resource }) => resource && !~resource.indexOf('/node_modules/') && !resource.startsWith(FAKE_HELPER_ROOT))
      .map(({ resource }) => resource)
      .concat(Array.from(this.additionalDependencies));
  }
}
