import sourceMapSupport from 'source-map-support';

const registeredSources = {};

sourceMapSupport.install({
  retrieveSourceMap: source => {

    if (registeredSources[source]) {
      return registeredSources[source];
    }

    return null;
  }
});

export const registerSource = (name, map, url) => registeredSources[name] = { map, url };
export const unregisterSource = name => delete registeredSources[name];
