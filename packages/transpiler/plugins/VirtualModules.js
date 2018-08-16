import VirtualModulesPlugin from 'webpack-virtual-modules';

export default class VirtualModules extends VirtualModulesPlugin {

  constructor({ providers, target }) {
    super({});
    this.target = target;
    this.providers = providers;
    this.resolved = {};

    for (const provider of providers) {
      provider.target = target;
    }
  }

  apply(compiler) {
    super.apply(compiler);

    compiler.hooks.run.tapPromise('VirtualModules', async () => {
      for (const provider of this.providers) {
        if (provider.apply) {
          await provider.apply(this, compiler);
        }
      }
    });

    compiler.resolverFactory.hooks.resolver.tap('normal', 'VirtualModules', resolver => {
      resolver.hooks.resolve.tapAsync('VirtualModules', async (request, resolveContext, callback) => {
        const innerRequest = request.request;
        let nextHook = resolver.hooks.describedResolve;
        for (const provider of this.providers) {

          const handled = await provider.handle(innerRequest, request.path);

          if (handled && handled.filename) {
            if (handled.content) {
              this.writeModule(handled.filename, handled.content);
            }

            nextHook = resolver.hooks.resolve;
            request.request = handled.filename;
            break;
          }
        }

        resolver.doResolve(nextHook, request, 'virtual modules', resolveContext, callback);
      });
    });
  }
}
