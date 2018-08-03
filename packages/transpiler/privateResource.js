import path from 'path';

const extensions = ['.svg', '.png', '.jpg', '.gif', '.css'];

export default function privateResource({ rpc }) {

  const resources = [];

  return {
    name: 'private resource',

    load: async id => {
      if (!extensions.includes(path.parse(id).ext)) {
        return null;
      }

      const publicPath = await rpc({
        helper: '@bytorsten/react/internal.GetResourceUri',
        sourcePath: id
      });

      resources.push(id);

      return `
        export default '${publicPath}';
      `;
    },

    generateBundle: () => {

      return rpc({
        helper: '@bytorsten/react/internal.CopyResources',
        resources
      });
    }
  };
}
