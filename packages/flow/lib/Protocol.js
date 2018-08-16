import { EventEmitter } from 'events';

export default class Protocol extends EventEmitter {

  constructor() {
    super();
    this._message = null;
    this._expectedLength = -1;
  }

  add(data) {
    if (data instanceof Buffer) {
      data = data.toString();
    }

    if (this._message === null) {
      const match = data.match(/<\[\[(?<length>[0-9]+)]]>(?<message>.*)/);
      if (!match) {
        throw new Error(`Malformed message: ${data}`);
      }

      this._expectedLength = Number(match.groups.length);
      this._message = match.groups.message;
    } else {
      this._message += data;
    }

    if (this._message !== null && this._message.length >= this._expectedLength) {
      const message = this._message.substring(0, this._expectedLength);
      this.emit('message', message.length > 0 ? JSON.parse(message) : {});

      const left = this._message.substring(this._expectedLength);
      this._message = null;
      this._expectedLength = 0;

      if (left.length > 0) {
        this.add(left);
      }
    }
  }

  format(data) {
    const payload = JSON.stringify(data);
    return `<[[${Buffer.from(payload).length}]]>${payload}`;
  }
}
