import { createServer } from 'net';
import { EventEmitter } from 'events';

import Protocol from './Protocol';

export default class Server extends EventEmitter {
  constructor(address) {
    super();

    if (address.startsWith('unix://')) {
      this.address = address.replace(/^unix:\/\//, '');
    } else {
      const [host, port ] = address.split(':');
      this.address = { host, port };
    }

    this._server = createServer(socket => {
      const protocol = new Protocol();
      let nextMessageId = 0;

      const messageResovlers = {};

      protocol.on('message', ({ command, data, messageId }) => {
        if (messageResovlers[command]) {
          messageResovlers[command](data);
          delete messageResovlers[command];
          return;
        }

        this.emit(
          'command',
          { command, data },
          {
            reply: messageId ? response => new Promise(resolve => {
              const payload = {
                command: messageId,
                data: typeof response === 'undefined' ? null : response
              };

              socket.write(protocol.format(payload), resolve);
            }) : null,

            send: (command, data) => new Promise(resolve => {

              const currentMessageId = `message_${++nextMessageId}`;

              const payload = {
                command,
                data,
                messageId: currentMessageId
              };

              messageResovlers[currentMessageId] = resolve;
              socket.write(protocol.format(payload));
            })
          }
        );
      });

      socket.on('data', protocol.add.bind(protocol));
    });

    this._server.once('listening', () => this.emit('ready', this.address));

    this._server.on('error', error => {
      this.emit('error', error);
    });
  }

  listen() {
    this._server.listen(this.address);
  }

  close(cb) {
    this._server.close(cb);
  }
}
