import vm from 'vm';
import { registerSource, unregisterSource } from '@bytorsten/sourcemap';

export default class Renderer {
  constructor({ bundle, context = {}, rpc, resolvedPaths = [], internalData = {} }) {
    this.bundle = bundle;
    this.context = context;
    this.rpc = rpc;
    this.internalData = internalData;
    this.resolvedPaths = resolvedPaths;
  }

  buildContext() {
    return vm.createContext({
      process: { env: { SSR: true } },
      require,
      console,
      __rpc: data => this.rpc(data),
      __internalData: this.internalData
    });
  }

  async renderUnit() {

    if (Object.keys(this.bundle).length !== 1) {
      throw new Error('Server bundle expects exactly one file');
    }

    const entry = this.bundle[0];

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
