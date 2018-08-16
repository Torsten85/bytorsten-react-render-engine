import crypto from 'crypto';

export default class FlowResourceProvider {

  constructor({ rpc }) {
    this.getRpc = rpc;
  }

  async handle(filename) {

    if (filename.startsWith('resource://')) {
      const rpc = this.getRpc();

      const { data, error } = await rpc({
        helper: '@bytorsten/react.ResourceUri',
        path: filename
      });

      if (error) {
        throw error;
      }

      const hash = crypto.createHash('md5').update(filename).digest('hex');
      
      return {
        filename: `/${hash}`,
        content: `export default '${data}';`
      };
    }
  }
}
