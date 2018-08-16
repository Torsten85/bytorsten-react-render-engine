import path from 'path';
import resolve from 'rollup-plugin-node-resolve';

const inputs = [
  'packages/main/index.js',
  'packages/transpiler/loader/ResourceLoader.js'
];

export default inputs.map(input => ({
  input,
  external: id => input !== id && !id.startsWith('@bytorsten') && id[0] !== '.' && id[0] !== '/',
  output: {
    file: `build/${path.basename(input)}`,
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
}));
