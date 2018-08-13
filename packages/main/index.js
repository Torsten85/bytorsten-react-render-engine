/* eslint-disable no-console */
import '@bytorsten/sourcemap';
import parseCommandLineArgs from 'command-line-args';
import Flow from '@bytorsten/flow';
import Transpiler from '@bytorsten/transpiler';
import Renderer from '@bytorsten/renderer';
import { isProduction } from '@bytorsten/helper';
import path from 'path';
import NodeCache from 'node-cache';

import './include';

Error.stackTraceLimit = Infinity;

process.on('unhandledRejection', Flow.terminate);

const options = parseCommandLineArgs([
  { name: 'address', type: String },
  { name: 'production', type: Boolean },
  { name: 'threads', type: Number }
]);

if (!options.address) {
  Flow.terminate('Please specify a socket path with the --address option');
}

process.env.NODE_ENV = options.production ? 'production' : 'development';

class App extends Flow {

  constructor({ address, threads = 1 }) {
    super({ address, threads });
    this.serverTranspileCaches = new NodeCache({ stdTTL: isProduction ? 0 : 600, useClones: false });
    this.clientTranspileCaches = new NodeCache({ stdTTL: isProduction ? 0 : 600, useClones: false });
    this.clientBundlePreparation = new NodeCache({ stdTTL: 60, useClones: false });
    this.renderUnits = new NodeCache({ stdTTL: isProduction ? 0 : 600, useClones: false });
  }

  async transpile({ identifier, serverFile, clientFile, helpers, hypotheticalFiles, aliases, extractDependencies, baseDirectory, prepareClientBundle }, { send, reply }) {
    const rpc = request => send('rpc', request);

    this.renderUnits.del(identifier);
    const previousCache = this.serverTranspileCaches.get(identifier);

    const transpiler = new Transpiler({ helpers, hypotheticalFiles, aliases, rpc });
    console.info(`Transpiling identifier "${identifier}"`);
    console.time('transpile');
    const { bundle, cache, resolvedPaths } = await transpiler.transpile({ file: serverFile, cache: previousCache, baseDirectory, target: 'async-node' });
    const dependencies = extractDependencies ? transpiler.getDependencies() : [];
    console.timeEnd('transpile');

    this.serverTranspileCaches.set(identifier, cache);
    reply({ bundle, resolvedPaths, dependencies });

    if (prepareClientBundle) {
      this.clientBundlePreparation.set(identifier, Promise
        .resolve(this.clientTranspileCaches.get(identifier))
        .then(async previousClientCache => {
          console.info(`Preparing bundle for identifier ${identifier}`);
          console.time('prepare bundle');
          const { bundle, cache } = await transpiler.transpile({ file: clientFile, cache: previousClientCache, baseDirectory, target: 'web' });
          console.timeEnd('prepare bundle');
          this.clientTranspileCaches.set(identifier, cache);
          return bundle;
        }));
    }
  }

  async render({ identifier, file, bundle, context, internalData, baseDirectory, resolvedPaths }, { send }) {
    const rpc = request => send('rpc', request);
    const renderer = new Renderer({ file, bundle, context, rpc, internalData, baseDirectory, resolvedPaths });
    console.info(`Rendering identifier "${identifier}"`);
    console.time('render');
    const unit = await renderer.renderUnit();
    const result = await unit.render();
    this.renderUnits.set(identifier, unit);
    console.timeEnd('render');

    return result;
  }

  async shallowRender({ identifier, context, internalData }, { send }) {
    const unit = this.renderUnits.get(identifier);

    if (!unit) {
      console.info(`Shallow rendering impossible, identifier "${identifier}" is unknown`);
      return null;
    }

    unit.updateRpc(request => send('rpc', request));
    unit.adjust({ context, internalData });

    console.info(`Shallow rendering identifier "${identifier}"`);
    console.time('render shallow');
    const result = await unit.render();
    console.timeEnd('render shallow');

    return result;
  }

  async bundle({ identifier, clientFile, helpers, hypotheticalFiles, aliases, baseDirectory }, { send }) {

    if (this.clientBundlePreparation.get(identifier)) {
      console.info(`Waiting for bundle preparation of ${identifier}`);
      console.time('bundle wait');
      const bundle = await this.clientBundlePreparation.get(identifier);
      console.timeEnd('bundle wait');
      this.clientBundlePreparation.del(identifier);
      return bundle;
    }

    const rpc = request => send('rpc', request);

    const previousCache = this.clientTranspileCaches.get(identifier);

    const transpiler = new Transpiler({ helpers, hypotheticalFiles, aliases, rpc });
    console.info(`Bundling identifier "${identifier}"`);
    console.time('bundle');
    const { bundle, cache } = await transpiler.transpile({ file: clientFile, cache: previousCache, baseDirectory, target: 'web' });
    console.timeEnd('bundle');

    this.clientTranspileCaches.set(identifier, cache);
    return bundle;
  }
}

const renderer = new App(options);
renderer.on('ready', address => {
  const parsedAddress = typeof address === 'string' ? path.parse(address).base : `${address.host}:${address.port}`;
  console.log(`Rendering engine online in ${isProduction() ? 'production' : 'development'} on ${parsedAddress}`);
});

renderer.on('stop', () => {
  console.log('Rendering engine shutting down');
});

renderer.start();
