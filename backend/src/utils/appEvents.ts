import { EventEmitter } from 'events';

class AppEvents extends EventEmitter { }

const appEvents = new AppEvents();

export enum AppEvent {
    AGENT_COLLECTION_RECONCILED = 'AGENT_COLLECTION_RECONCILED',
    BULK_ORDERS_IMPORTED = 'BULK_ORDERS_IMPORTED',
    ORDERS_DELETED = 'ORDERS_DELETED',
    // Add more as needed
}

export default appEvents;
