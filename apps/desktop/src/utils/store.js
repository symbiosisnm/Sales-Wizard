import { EventEmitter } from 'events';

class Store extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'idle' };
  }

  setStatus(status) {
    if (this.state.status !== status) {
      this.state.status = status;
      this.emit('status', status);
    }
  }

  getStatus() {
    return this.state.status;
  }
}

const store = new Store();
export default store;
