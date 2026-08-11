import type { ClientSession } from 'mongodb'
import type { DomainEvent } from './domain-event.type'

export interface DomainEventPublishOptions {
  session?: ClientSession
  deliver?: boolean
}

export interface TransactionalDomainEventPublishOptions {
  session: ClientSession
}

export interface DomainEventHandler<TResult> {
  handle(event: unknown, options?: DomainEventPublishOptions): Promise<TResult>
}

export interface DomainEventPublisher<TResult> {
  publish(event: DomainEvent, options?: DomainEventPublishOptions): Promise<TResult>
}

export interface TransactionalDomainEventPublisher<TResult> {
  publish(event: DomainEvent, options: TransactionalDomainEventPublishOptions): Promise<TResult>
}

export class InlineDomainEventPublisher<TResult> implements DomainEventPublisher<TResult> {
  constructor(private readonly handler: DomainEventHandler<TResult>) {}

  publish(event: DomainEvent, options: DomainEventPublishOptions = {}): Promise<TResult> {
    return this.handler.handle(event, options)
  }
}
