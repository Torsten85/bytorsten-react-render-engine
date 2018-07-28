import path from 'path';
import Processor from '@bytorsten/processor';
import { nodeModulesPath } from '@bytorsten/helper';

export default class Renderer {
  constructor({ file, bundle, context = {}, rpc, resolvedPaths = [], baseDirectory, internalData = {} }) {
    this.bundle = bundle;
    this.context = context;
    this.rpc = rpc;
    this.internalData = internalData;
    this.resolvedPaths = resolvedPaths;
    this.file = path.basename(file);

    const basedir = baseDirectory || path.dirname(file);
    this.paths = [basedir, nodeModulesPath];
  }

  buildContext() {
    return {
      process: { env: { SSR: true } },
      console,
      __rpc: data => this.rpc(data),
      __internalData: this.internalData
    };
  }

  async renderUnit() {

    const processor = new Processor({
      bundle: this.bundle,
      paths: this.paths,
      resolvedPaths: this.resolvedPaths
    });

    processor.setContext(this.buildContext());
    const render = await processor.process(this.file);

    return {
      render: () => render({ context: this.context }),

      updateRpc: rpc => {
        this.rpc = rpc;
      },

      adjust: ({ context, internalData }) => {
        this.context = context;
        this.internalData = internalData;
        processor.context.__internalData = internalData;
      }
    };
  }
}
