import crypto from 'node:crypto';
import {
  validateCreateRepository,
  validateUpdateRepository,
  validateMergedRepository,
  DomainError,
  RepositoryNotFoundError,
  type RepositoryRecord,
  type RepositoryMutationEvent
} from '@orca/shared';
import { RepositoryStore } from './repository-store.js';
import { RunStore } from '../loop/run-store.js';
import { EventBus } from '../events/event-bus.js';

export class RepositoryService {
  constructor(
    private readonly store: RepositoryStore,
    private readonly eventBus: EventBus,
    private readonly runStore: RunStore
  ) {}

  listRepositories(): RepositoryRecord[] {
    return this.store.list();
  }

  getRepository(id: string): RepositoryRecord {
    const record = this.store.get(id);
    if (!record) {
      throw new RepositoryNotFoundError(id);
    }
    return record;
  }

  createRepository(input: unknown): RepositoryRecord {
    const validated = validateCreateRepository(input);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const record: RepositoryRecord = {
      id,
      ...validated,
      createdAt: now,
      updatedAt: now
    };

    const created = this.store.create(record);

    const event: RepositoryMutationEvent = {
      type: 'repository.created',
      at: now,
      repositoryId: id,
      data: {
        repository: created
      }
    };
    this.eventBus.publish(event);

    return created;
  }

  updateRepository(id: string, patchInput: unknown): RepositoryRecord {
    const current = this.getRepository(id);
    const patch = validateUpdateRepository(patchInput);
    const merged = validateMergedRepository(current, patch);

    const updated = this.store.update(merged);

    const event: RepositoryMutationEvent = {
      type: 'repository.updated',
      at: updated.updatedAt,
      repositoryId: id,
      data: {
        repository: updated
      }
    };
    this.eventBus.publish(event);

    return updated;
  }

  deleteRepository(id: string): void {
    this.getRepository(id);

    const activeRun = this.runStore.getActiveRun(id);
    if (activeRun) {
      // 409 conflict: deleting mid-run cascades away runs/dispatches/executor
      // rows the executor child process and loop timers still reference.
      throw new DomainError(
        'REPOSITORY_ACTIVE_RUN',
        `Repository "${id}" cannot be deleted while run "${activeRun.id}" is active.`,
        409
      );
    }

    const deleted = this.store.delete(id);
    if (deleted) {
      const now = new Date().toISOString();
      const event: RepositoryMutationEvent = {
        type: 'repository.deleted',
        at: now,
        repositoryId: id
      };
      this.eventBus.publish(event);
    }
  }
}
