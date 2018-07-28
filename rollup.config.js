import resolve from 'rollup-plugin-node-resolve';

const input = 'packages/main/index.js';

export default {
  input,
  external: id => id !== input && !id.startsWith('@bytorsten') && id[0] !== '.' && id[0] !== '/',
  output: {
    file: 'build/index.js',
    sourcemap: true,
    banner: '#!/usr/bin/env node --no-warnings --experimental-vm-modules',
    format: 'cjs'
  },

  plugins: [
    resolve({
      only: [/^@bytorsten\//]
    })
  ],

  watch: {
    chokidar: true,
    exclude: ['node_modules/**']
  }
};
