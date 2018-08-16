import Module, { builtinModules } from 'module';

function updateChildren(parent, child, scan) {
  var children = parent && parent.children;
  if (children && !(scan && children.includes(child)))
    children.push(child);
}

function tryModuleLoad(module, filename) {
  var threw = true;
  try {
    module.load(filename);
    threw = false;
  } finally {
    if (threw) {
      delete Module._cache[filename];
    }
  }
}

export default class VmModule extends Module {

  constructor(id, parent) {
    super(id, parent);
    this.require = this.require.bind(this);
  }

  require(request) {
    const filename = this.resolveFilename(request);
    const cachedModule = VmModule._cache[filename];
    if (cachedModule) {
      updateChildren(this, cachedModule, true);
      return cachedModule.exports;
    }

    if (builtinModules.includes(filename)) {
      return Module._load(filename, this, false);
    }

    const module = this.createChild(filename);
    VmModule._cache[filename] = module;
    tryModuleLoad(module, filename);
    return module.exports;
  }

  resolveFilename(request) {
    return Module._resolveFilename(request, this, false, {});
  }

  createChild(filename) {
    return new this.constructor(filename, this);
  }
}
