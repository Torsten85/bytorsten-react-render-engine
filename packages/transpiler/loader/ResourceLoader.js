import loaderUtils from 'loader-utils';

export default async function () {
  const callback = this.async();
  const options = loaderUtils.getOptions(this);
  const rpc = options.rpc();

  const { userRequest, rawRequest } = this._module;

  const { data, error } = await rpc({
    helper: '@bytorsten/react/internal.PublishResourceUri',
    relativeRequest: rawRequest,
    absoluteRequest: userRequest
  });

  if (error) {
    throw error;
  }

  callback(null, `export default '${data}';`);
}
