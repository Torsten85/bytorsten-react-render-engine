import path from 'path';
import crypto from 'crypto';

const extensions = ['.svg', '.png', '.jpg', '.gif', '.css'];

export default class PrivateResourceProvider {

  constructor({ rpc }) {
    this.getRpc = rpc;
    this.resources = [];
    this.target = null;
  }

  async handle(filename, requestPath) {
    if (!extensions.includes(path.parse(filename).ext)) {
      return null;
    }

    const rpc = this.getRpc();
    const sourcePath = path.join(requestPath, filename);
    const { data, error } = await rpc({
      helper: '@bytorsten/react/internal.GetResourceUri',
      sourcePath
    });

    this.resources.push(sourcePath);

    const response = {
      filename: '/' + crypto.createHash('md5').update(sourcePath).digest('hex')
    };

    if (error) {
      response.content = `
        console.error('${error.message}');
        console.error('${error.stack}');
        export default null;
      `;
    } else {
      response.content = `export default '${data}';`;
    }

    return response;
  }

  async finalize() {
    if (this.target === 'node') {
      return this.getRpc()({
        helper: '@bytorsten/react/internal.CopyResources',
        resources: this.resources
      });
    }
  }
}
