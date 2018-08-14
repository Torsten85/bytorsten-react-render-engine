import vm from 'vm';
import path from 'path';
import { registerSource, unregisterSource } from '@bytorsten/sourcemap';

export default class Renderer {
  constructor({ bundle, context = {}, rpc, internalData = {} }) {
    this.bundle = bundle;
    this.context = context;
    this.rpc = rpc;
    this.internalData = internalData;
  }

  buildContext() {
    return vm.createContext({
      process: { env: { SSR: true } },
      global: {},
      require: packageName => {
        const module = this.bundle.find(({ name }) => name === path.join(packageName));

        if (module) {
          const vmContext = this.buildContext();
          vmContext.exports = {};
          registerSource(module.name, module.map);
          vm.runInNewContext(module.code, vmContext);
          unregisterSource(module.name);
          return vmContext.exports;
        }

        return require(packageName); // eslint-disable-line import/no-dynamic-require
      },
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

    registerSource(entry.name, entry.map);
    const render = vm.runInNewContext(entry.code, vmContext).default;
    unregisterSource(entry.name);

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
