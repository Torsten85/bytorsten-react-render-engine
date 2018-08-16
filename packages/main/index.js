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
    this.renderUnits = new NodeCache({ stdTTL: isProduction ? 0 : 600, useClones: false });
  }

  async transpile({ identifier, file, helpers, hypotheticalFiles, aliases, extractDependencies, baseDirectory, publicPath }, { send }) {
    const rpc = request => send('rpc', request);

    this.renderUnits.del(identifier);
    const previousCache = this.serverTranspileCaches.get(identifier);

    const transpiler = new Transpiler({ helpers, hypotheticalFiles, aliases, rpc });
    console.info(`Transpiling identifier "${identifier}" with${previousCache ? '' : 'out'} cache`);
    console.time('transpile');
    const { bundle, cache, excluded } = await transpiler.transpile({ file, cache: previousCache, baseDirectory, publicPath, target: 'node' });
    const dependencies = extractDependencies ? transpiler.getDependencies() : [];
    console.timeEnd('transpile');

    this.serverTranspileCaches.set(identifier, cache);
    return { bundle, dependencies, excluded };
  }

  async render({ identifier, excluded, bundle, context, internalData }, { send }) {
    const rpc = request => send('rpc', request);
    const renderer = new Renderer({ bundle, excluded, context, rpc, internalData });
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
    console.time('shallow render');
    const result = await unit.render();
    console.timeEnd('shallow render');

    return result;
  }

  async bundle({ identifier, file, helpers, hypotheticalFiles, aliases, baseDirectory, publicPath, externals }, { send }) {
    const rpc = request => send('rpc', request);

    const previousCache = this.clientTranspileCaches.get(identifier);

    const transpiler = new Transpiler({ helpers, hypotheticalFiles, aliases, rpc });
    console.info(`Bundling identifier "${identifier}" with${previousCache ? '': 'out'} cache`);
    console.time('bundle');
    const { bundle, cache } = await transpiler.transpile({ file, cache: previousCache, baseDirectory, publicPath, externals, target: 'web' });
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
