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

      const { data, error } = await rpc({
        helper: '@bytorsten/react/internal.GetResourceUri',
        sourcePath: id
      });

      resources.push(id);

      if (error) {
        return `
          console.error('${error.message}');
          console.error('${error.stack}');
          export default null;
        `;
      }

      return `
        export default '${data}';
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
