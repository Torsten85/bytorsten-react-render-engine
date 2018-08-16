export default class HypotheticalFilesProvider {
  constructor(files) {
    this.files = files;
  }

  handle(filename) {
    if (this.files[filename]) {
      return {
        filename: `/${filename}`,
        content: this.files[filename]
      };
    }
  }

  apply(virtualModules) {
    for (const filename in this.files) {
      virtualModules.writeModule(`/${filename}`, this.files[filename]);
    }
  }
}
