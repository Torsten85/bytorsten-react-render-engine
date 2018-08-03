import { Module, createContext } from 'vm';
import path from 'path';
import { registerSource } from '@bytorsten/sourcemap';
import { resolveModule } from '@bytorsten/helper';
import { Module as SystemModule } from 'module';

const toUrl = filename => `file://${filename}/`;

export default class Processor {

  constructor({ bundle, resolvedPaths = {}, paths = [] }) {
    this.bundle = bundle;
    this.paths = paths.map(p => path.resolve(p));
    this.resolvedModules = {};
    this.resolvedPaths = resolvedPaths;
    this.context = createContext({});
  }

  setContext(context) {
    Object.assign(this.context, context);
  }

  async require(moduleName) {
    if (this.resolvedPaths[moduleName]) {
      return require(this.resolvedPaths[moduleName]); //eslint-disable-line import/no-dynamic-require
    }

    const modulePath = await resolveModule(moduleName, { basedir: this.paths[0], paths: this.paths.slice(1) });
    if (modulePath) {
      return require(modulePath); //eslint-disable-line import/no-dynamic-require
    }

    return null;
  }

  sanitize(code) {
    const dynamicImports = [];
    const sanitizedCode = code.replace(/import\(([^)]+)\)/g, (_, rawModuleName) => {
      const moduleName = rawModuleName.replace(/\/\*.+\*\//, '').replace(/(\s|"|')/g, '');
      dynamicImports.push(moduleName);
      return `Promise.resolve(import_${dynamicImports.length - 1})`;
    });

    if (dynamicImports.length === 0) {
      return sanitizedCode;
    }

    const importCode = dynamicImports.map((imp, index) => `import import_${index} from '${imp}';`).join('\n');

    return [
      importCode,
      sanitizedCode
    ].join('\n');
  }

  resolveModuleFromBundle(specifier) {
    const moduleName = path.join(specifier);

    if (!this.bundle[moduleName]) {
      return null;
    }

    const { code, map } = this.bundle[moduleName];
    const filename = toUrl(specifier);
    registerSource(filename, map);
    return new Module(this.sanitize(code), {
      context: this.context,
      url: filename
    });
  }



  async resolveModuleFromPaths(specifier) {

    try {
      const module = await this.require(specifier, this.paths[0]);

      let exportPath = 'module';
      let namedExports = '';

      if (typeof module === 'object') {
        const propertyNames = Object.getOwnPropertyNames(module);

        if (propertyNames.includes('default')) {
          exportPath = 'module.default';
        }

        const names = propertyNames
          .filter(name => name !== '__esModule' && name !== 'default')
          .join(',');

        namedExports = `
          const {${names}} = module;
          export {${names}};
        `;
      }

      const code = `
        const { module } = import.meta;
        export default ${exportPath};
        ${namedExports}
      `;

      return new Module(code, {
        context: this.context,
        initializeImportMeta: meta => {
          meta.module = module;
        }
      });
    } catch (error) {
      console.error(specifier, error);
      return null;
    }
  }

  async resolveModule(specifier) {

    if (this.resolvedModules[specifier]) {
      return this.resolvedModules[specifier];
    }

    let module = this.resolveModuleFromBundle(specifier);

    if (module === null) {
      module = await this.resolveModuleFromPaths(specifier);
    }

    if (module === null) {
      throw new Error(`Could not resolve module "${specifier}" in paths ${this.paths.map(p => `"${p}"`).join(', ')}`);
    }

    this.resolvedModules[specifier] = module;
    return module;
  }

  // we alter the system wide require lookup algorithm to retry failed attempts with the current evaluating path
  async withChangedSystemCode(fn) {

    const originalResolve = SystemModule._resolveFilename;

    SystemModule._resolveFilename = (request, parent, isMain, options) => {
      try {
        return originalResolve(request, parent, isMain, options);
      } catch (error) {
        return originalResolve(request, parent, isMain, { paths: this.paths });
      }
    };

    const result = await fn();

    SystemModule._resolveFilename = originalResolve;

    return result;
  }

  async process(filename) {
    if (!(filename in this.bundle)) {
      throw new Error(`The provided bundle does not include a file named ${filename}`);
    }

    const rootCode = `
      import result from '${filename}';
      result;
    `;

    const rootModule = new Module(rootCode, {
      context: this.context
    });

    return this.withChangedSystemCode(async () => {
      await rootModule.link(this.resolveModule.bind(this));
      rootModule.instantiate();
      const { result } = await rootModule.evaluate();
      return result;
    });
  }
}
