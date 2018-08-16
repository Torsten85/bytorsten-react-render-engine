import vm from 'vm';
import path from 'path';
import { registerSource, unregisterSource } from '@bytorsten/sourcemap';
import ResolvingModule from './ResolvingModule';

export default class Renderer {
  constructor({ bundle, context = {}, rpc, excluded = {}, internalData = {} }) {
    this.bundle = bundle;
    this.context = context;
    this.rpc = rpc;
    this.internalData = internalData;

    this.module = new ResolvingModule({

      require: moduleName => {
        return this.loadModuleFromBundle(moduleName);
      },

      resolveFilename: moduleName => {
        return excluded[moduleName];
      }
    });
  }

  loadModuleFromBundle(moduleName) {
    const module = this.bundle.find(({ name }) => name === path.join(moduleName));

    if (module) {
      const vmContext = this.buildContext();
      vmContext.exports = {};
      registerSource(module.name, module.map);
      vm.runInNewContext(module.code, vmContext, {
        filename: module.name
      });

      unregisterSource(module.name);
      return vmContext.exports;
    }

    return null;
  }

  buildContext() {
    return vm.createContext({
      process: { env: { SSR: true } },
      global: {
        Promise
      },
      Buffer,
      Promise,
      exports,
      require: this.module.require,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      __rpc: data => this.rpc(data),
      __internalData: this.internalData
    });
  }

  async renderUnit() {

    const initials = this.bundle.filter(m => m.initial);

    if (initials.length !== 1) {
      throw new Error('Could not find initial package.');
    }

    const entry = initials[0];
    const vmContext = this.buildContext();

    const render = vm.runInNewContext(entry.code, vmContext, {
      filename: entry.name
    }).default;

    return {
      render: async () => {
        registerSource(entry.name, entry.map);
        const result = await render({ context: this.context });
        unregisterSource(entry.name);
        return result;
      },

      updateRpc: rpc => {
        this.rpc = rpc;
      },

      adjust: ({ context, internalData }) => {
        this.context = context;
        this.internalData = internalData;
        vmContext.__internalData = internalData;
      }
    };
  }
}
