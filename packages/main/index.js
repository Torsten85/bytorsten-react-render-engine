/* eslint-disable no-console */
import '@bytorsten/sourcemap';
import parseCommandLineArgs from 'command-line-args';
import Flow from '@bytorsten/flow';
import Transpiler from '@bytorsten/transpiler';
import Renderer from '@bytorsten/renderer';
import Bundler from '@bytorsten/bundler';
import { isProduction } from '@bytorsten/helper';
import path from 'path';

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
    this.renderUnits = {};
    this.cacheBundles = {};
  }

  async transpile({ identifier, serverFile, clientFile, helpers, scriptName, hypotheticalFiles, aliases, extractDependencies }, { send }) {
    const rpc = request => send('rpc', request);

    delete this.renderUnits[identifier];

    const transpiler = new Transpiler({ serverFile, scriptName, clientFile, helpers, hypotheticalFiles, aliases, rpc });
    console.info(`Transpiling identifier "${identifier}"`);
    console.time('transpile');
    const { bundle, resolvedPaths } = await transpiler.transpile();
    const dependencies = extractDependencies ? transpiler.getDependencies() : [];
    console.timeEnd('transpile');

    return { bundle, resolvedPaths, dependencies };
  }

  async render({ identifier, file, bundle, context, internalData, baseDirectory, resolvedPaths }, { send }) {
    const rpc = request => send('rpc', request);
    const renderer = new Renderer({ file, bundle, context, rpc, internalData, baseDirectory, resolvedPaths });
    console.info(`Rendering identifier "${identifier}"`);
    console.time('render');
    const unit = await renderer.renderUnit();
    const result = await unit.render();
    this.renderUnits[identifier] = unit;
    console.timeEnd('render');

    return result;
  }

  async shallowRender({ identifier, context, internalData }, { send }) {
    const unit = this.renderUnits[identifier];

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

  async bundle({ identifier, file, baseBundle, legacy, baseDirectory, aliases, hypotheticalFiles, chunkPath }) {
    const bundler = new Bundler({ file, baseBundle, chunkPath, baseDirectory, aliases, hypotheticalFiles });
    console.info(`Bundling identifier "${identifier}" ${this.cacheBundles[identifier] ? 'with' : 'without'} cached bundle`);
    console.time('bundle');
    const { bundle, cache } = await bundler.bundle({
      legacy,
      cache: this.cacheBundles[identifier] || null
    });
    console.timeEnd('bundle');

    if (!isProduction()) {
      this.cacheBundles[identifier] = cache;
    }

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
