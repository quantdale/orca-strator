import { EventEmitter } from 'node:events';
import type { RepositoryMutationEvent } from '@orca/shared';

export class EventBus extends EventEmitter {
  publish(event: RepositoryMutationEvent): void {
    this.emit('event', event);
  }

  subscribe(listener: (event: RepositoryMutationEvent) => void): () => void {
    this.on('event', listener);
    return () => {
      this.off('event', listener);
    };
  }
}
