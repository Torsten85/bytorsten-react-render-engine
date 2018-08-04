const PREFIX = '\0resource-proxy:';

export default function flowResource({ rpc }) {
  return {
    name: 'flow-resource',

    resolveId: importee => {
      if (importee.startsWith('resource://')) {
        return PREFIX + importee;
      }

      return null;
    },

    load: async id => {
      if (!id.startsWith(PREFIX)) {
        return null;
      }

      const resource = id.substring(PREFIX.length);

      const { data, error } = await rpc({
        helper: '@bytorsten/react.ResourceUri',
        path: resource
      });

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
    }
  };
}
