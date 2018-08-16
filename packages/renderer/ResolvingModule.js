import VmModule from './VmModule';

export default class ResolvingModule extends VmModule {

  constructor(options, filename, parent) {
    super(filename, parent);
    this.options = options;
  }

  require(moduleName) {
    if (this.options.require) {
      const result = this.options.require(moduleName, this);
      if (result) {
        return result;
      }
    }

    return super.require(moduleName);
  }

  resolveFilename(moduleName) {
    try {
      return super.resolveFilename(moduleName);
    } catch (error) {
      const resolveResult = this.options.resolveFilename ? this.options.resolveFilename(moduleName, this) : null;
      if (resolveResult) {
        return super.resolveFilename(resolveResult);
      } else {
        throw error;
      }
    }
  }

  createChild(filename) {
    return new this.constructor(this.options, filename, this);
  }
}
