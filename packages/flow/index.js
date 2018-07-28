import { EventEmitter } from 'events';
import cluster from 'cluster';
import fs from 'fs';

import Server from './lib/Server';

const READY_FLAG = '[[READY]]';

export default class Flow extends EventEmitter {

  static terminate(error) {
    console.error(error);
    process.exit(1);
  }

  constructor({ address, threads }) {
    super();
    this.threads = threads;
    this.address = address;
  }

  createServer() {
    const server = new Server(this.address);

    server.on('ready', address => {
      process.stdout.write(READY_FLAG);
      this.emit('ready', address);
    });

    server.on('error', Flow.terminate);
    server.on('command', async ({ command, data }, { reply, send }) => {
      if (!this[command]) {
        return Flow.terminate(new Error(`Unknown command ${command}`));
      }

      let replied = false;
      let result;

      try {

        result = await this[command](data, {
          reply: response => {
            replied = true;
            return reply(response);
          },
          send
        });

      } catch (error) {
        Flow.terminate(error);
      }

      if (!replied) {
        reply(result);
      }
    });

    return server;
  }

  start() {

    if (cluster.isMaster) {
      if (this.address.startsWith('unix://')) {
        try {
          fs.unlinkSync(this.address.replace(/^unix:\/\//, ''));
        } catch (error) {
          // do nothing
        }
      }

      cluster.setupMaster({
        execArgv: []
      });

      process.on('SIGTERM', () => this.stop());

      if (this.threads === 1) {
        this.server = this.createServer();
        this.server.listen();
      } else {
        for (let i = 0; i < this.threads; i++) {
          cluster.fork();
        }
      }
    } else {
      this.server = this.createServer();
      this.server.listen();
    }


  }

  stop() {
    const callback = () => process.exit(0);
    if (this.threads === 1) {
      this.server.close(callback);
    } else if (cluster.isMaster) {
      cluster.disconnect(callback);
    }
  }
}
