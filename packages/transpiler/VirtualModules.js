import VirtualModulesPlugin from 'webpack-virtual-modules';

export default class VirtualModules extends VirtualModulesPlugin {

  constructor(providers) {
    super({});
    this.providers = providers;
    this.dynamicModules = {};
    this.resolved = {};
  }

  writeModule(filename, content) {
    this.dynamicModules[filename] = content;
    super.writeModule(filename, content);
  }

  updateTarget(target) {
    for (const provider of this.providers) {
      provider.target = target;
    }
  }

  apply(compiler) {
    super.apply(compiler);

    const sourceName = 'described-resolve';
    const targetName = 'resolve';

    compiler.hooks.done.tapPromise('VirtualModules', async () => {
      for (const provider of this.providers) {
        if (provider.finalize) {
          await provider.finalize();
        }
      }
    });

    compiler.resolverFactory.plugin('resolver normal', resolver => {

      for (const filename in this.dynamicModules) {
        this.writeModule(filename, this.dynamicModules[filename]);
      }

      const target = resolver.ensureHook(targetName);
      resolver.getHook(sourceName).tapPromise('VirtualModules', async (request, resolveContext) => {
        const innerRequest = request.request;

        if (this.resolved[innerRequest]) {
          return this.resolved[innerRequest];
        }

        for (const provider of this.providers) {
          const handled = await provider.handle(innerRequest, request.path);

          if (handled && handled.filename) {
            if (handled.content) {
              this.writeModule(handled.filename, handled.content);
            }

            return new Promise((resolve, reject) => {
              resolver.doResolve(target, { ...request, request: handled.filename }, `resolved ${innerRequest}`, resolveContext, (error, result) => {
                if (error) {
                  reject(error);
                } else {
                  this.resolved[innerRequest] = result;
                  resolve(result);
                }
              });
            });
          }
        }
      });
    });
  }
}
