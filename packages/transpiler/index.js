import { isProduction, nodeModulesPath } from '@bytorsten/helper';
import path from 'path';
import webpack from 'webpack';
import MemoryFS from 'memory-fs';

import VirtualModules from './VirtualModules';
import HelperProvider from './HelperProvider';
import FlowResourceProvider from './FlowResourceProvider';
import HypotheticalFilesProvider from './HypotheticalFilesProvider';
import PrivateResourceProvider from './PrivateResourceProvider';

const FAKE_BUNDLED_ROOT = '/__bundled';
const FAKE_HELPER_ROOT = '/__helpers';

export default class Transpiler {
  constructor({ helpers, hypotheticalFiles, aliases, rpc }) {
    this.alises = aliases;
    this.rpc = rpc;
    this.virtualModules = new VirtualModules([
      new HelperProvider({ helpers, baseFolder: FAKE_HELPER_ROOT, hypotheticalFiles }),
      new FlowResourceProvider({ rpc: () => this.rpc }),
      new PrivateResourceProvider({ rpc: () => this.rpc }),
      new HypotheticalFilesProvider(hypotheticalFiles)
    ]);
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

  buildConfig({ file, target, baseDirectory }) {
    this.virtualModules.updateTarget(target);

    return {
      mode: target === 'web' && isProduction() ? 'production' : 'development',
      bail: true,
      devtool: isProduction() ? null : 'cheap-module-source-map',
      entry: file,
      output: {
        path: FAKE_BUNDLED_ROOT,
        filename: 'bundle.js',
        chunkFilename: '[name].chunk.js',
        devtoolModuleFilenameTemplate: '[resource-path]'
      },
      resolve: {
        modules: [
          path.join(baseDirectory || path.dirname(file), 'node_modules'),
          nodeModulesPath
        ],
        alias: this.alises
      },
      target,
      plugins: [
        this.virtualModules
      ],
      optimization: target === 'web' ? {
        splitChunks: {
          chunks: 'all',
          name: 'vendors'
        },
        runtimeChunk: true
      } : {},
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
                test: /\.(js|jsx|mjs)$/,
                exclude: [/[/\\\\]node_modules[/\\\\]/],
                use: [
                  {
                    loader: require.resolve('babel-loader'),
                    options: {
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
  }

  async transpile({ cache, file, target, baseDirectory } = {}) {

    const config = this.buildConfig({ file, target, baseDirectory });
    config.cache = cache;

    const memoryFS = new MemoryFS();
    memoryFS.mkdirSync(FAKE_BUNDLED_ROOT);

    const compiler = webpack(config);
    compiler.outputFileSystem = memoryFS;

    const stats = await new Promise((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) {
          return reject(error);
        }

        const { compilation: { errors, warnings } } = stats;

        if (errors.length > 0) {
          return reject(errors[0]);
        }

        if (warnings.length > 0) {
          return reject(warnings[0]);
        }

        resolve(stats);
      });
    });

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

    return { bundle, cache: stats.compilation.cache, resolvedPaths: {} };
  }

  getDependencies() {
    const { modules } = this.stats.compilation;

    return modules
      .filter(({ resource }) => resource && !~resource.indexOf('/node_modules/') && !resource.startsWith(FAKE_HELPER_ROOT))
      .map(({ resource }) => resource);
  }
}
