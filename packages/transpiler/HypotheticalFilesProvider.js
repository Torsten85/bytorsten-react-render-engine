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
}
