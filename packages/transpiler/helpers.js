import path from 'path';
import { loadFile, resolveModule, getModuleVersion } from '@bytorsten/helper';
import semverDiff from 'semver-diff';

const containsPrefix = (array, prefix) => array.reduce((found, item) => {
  return found || prefix.indexOf(item) === 0;
}, false);

const resolvePackageNameFromImporter = (importer, extensionDirNames) => {
  if (importer[0] === '@') {
    return importer.split('/').slice(0, 2).join('/');
  }
  const dirname = path.dirname(importer);
  return Object.keys(extensionDirNames).reduce((resolvedPackageName, currentPackageName) => {
    if (resolvedPackageName) {
      return resolvedPackageName;
    }

    if (dirname.indexOf(extensionDirNames[currentPackageName]) === 0) {
      return currentPackageName;
    }
  }, null);
};

export default ({ helpers, baseDirectory, addResolvedPath, addDependency }) => {
  const helperModuleNames = Object.keys(helpers);
  const helperModuleRpcNames = helperModuleNames.map(key =>  `${key}/_rpc`);
  const resolvePaths = {};
  const resolvedVersions = {};

  const extensionDirNames = helperModuleNames.reduce((files, moduleName) => {
    if (helpers[moduleName].__extension) {
      files[moduleName] = path.dirname(helpers[moduleName].__extension);
    }

    return files;
  }, {});

  const getVersion = async (name, path) => {
    const identifier = name + path;
    if (typeof resolvedVersions[identifier] !== 'undefined') {
      return resolvedVersions[identifier];
    }

    return resolvedVersions[identifier] = await getModuleVersion(name, { basedir: path });
  };

  // replaces the import inside helpers with a placeholder
  // later on the processor will resolve that import with the correct node module
  const registerExternalResolverPath = async ({ importer, importee }) => {
    if (!importer) {
      return;
    }

    const packageName = resolvePackageNameFromImporter(importer, extensionDirNames);

    if (~helperModuleNames.indexOf(packageName) && extensionDirNames[packageName]) {
      const extensionPath = extensionDirNames[packageName];



      const result = await resolveModule(importee, { basedir: extensionPath });
      if (!result) {
        return null;
      }

      const version = await getVersion(importee, extensionPath);
      const parentVersion = await getVersion(importee, baseDirectory);

      // we check if the required package from the helper is nearly the same as the package in our root bundle
      // if there are nearly equal, we do not include it
      if (version && parentVersion) {
        const diff = semverDiff(version, parentVersion);

        if (diff === null || diff === 'patch') {
          return null;
        }
      }

      const resolveName = `${packageName}_${importee}`;
      addResolvedPath(resolveName, result);
      return resolveName;
    }
  };

  return {
    resolveId: async (importee, importer) => {
      if (resolvePaths[importer]) {
        if (importee[0] === '.') {
          return path.resolve(resolvePaths[importer], importee + '.js');
        }
      }

      if (containsPrefix(helperModuleNames, importee) || ~helperModuleRpcNames.indexOf(importee)) {
        return importee;
      }

      return registerExternalResolverPath({ importer, importee });
    },

    load: id => {
      if (~helperModuleNames.indexOf(id)) {
        return buildHelperCode(id, helpers[id], path => resolvePaths[id] = path, addDependency);
      }

      if (~helperModuleRpcNames.indexOf(id)) {
        const moduleName = id.replace(/\/_rpc$/, '');
        return buildHelperRpcCode(moduleName, helpers[moduleName]);
      }

      return resolveSubModule(id, helperModuleNames, extensionDirNames, path => resolvePaths[id] = path, addDependency);
    }
  };
};

const buildHelperCode = async (moduleName, moduleHelpers, addResolvePath, addDependency) => {

  let extensionFile;
  if (moduleHelpers.__extension) {
    extensionFile = moduleHelpers.__extension;
    delete moduleHelpers.__extension;
  }

  const helperModuleNames = Object.keys(moduleHelpers);

  const code = `export { ${helperModuleNames.join(', ')} } from '${moduleName}/_rpc';`;

  if (extensionFile) {
    const extensionFileContent = await loadFile(extensionFile);
    addResolvePath(path.dirname(extensionFile));
    addDependency(extensionFile);

    return [
      code,
      extensionFileContent
    ].join('\n');
  }

  return code;
};

const buildHelperRpcCode = async (moduleName, moduleHelpers) => {

  const moduleHelperNames = Object.keys(moduleHelpers);

  if (moduleHelperNames.length === 0) {
    return '';
  }

  const code = [`
    import React from 'react';
    import { Rpc } from '@bytorsten/react';
  `];

  const helperTemplate = `
    export const %EXPORT_NAME% = ({ children, forceFetch, ...variables }) => (
      <Rpc helper="%MODULE_NAME%.%EXPORT_NAME%" variables={variables} forceFetch={forceFetch}>
        {children}
      </Rpc>
    );
  `;

  code.push(...Object.keys(moduleHelpers).map(helper => helperTemplate
    .replace(/%MODULE_NAME%/g, moduleName)
    .replace(/%EXPORT_NAME%/g, helper)
  ));

  return code.join('\n');
};

const resolveSubModule = async (id, helperModuleNames, extensionDirNames, addResolvePath, addDependency) => {
  // load sub module like "@vendor/package/server.js"
  const resolvedModuleName = id.split('/').slice(0, 2).join('/');
  if (~helperModuleNames.indexOf(resolvedModuleName) && extensionDirNames[resolvedModuleName]) {
    const filename = id.substring(resolvedModuleName.length + 1) + '.js';
    const directory = extensionDirNames[resolvedModuleName];
    addResolvePath(directory);
    const filePath = path.join(directory, filename);
    try {
      const file = await loadFile(filePath);
      addDependency(filePath);
      return file;
    } catch (error) {
      // do nothing
    }
  }
};
