import * as fastJsonPatch from 'fast-json-patch';

export enum CollectionEvent {
  loadAll = 'loadAll',

  load = 'load',
}

export abstract class BaseMap {
  _data: Map<string, any>;

  _events: Map<string, Function>;

  constructor(data = new Map<string, any>()) {
    this._events = new Map<string, Function>();

    this._data = data;
  }

  async loadAll() {
    await this.__loadAll();

    if (this.hasEvent(CollectionEvent.loadAll)) {
      await this.getEvent(CollectionEvent.loadAll)(this);
    }
  }

  async addElement(e: any) {
    this.__validateElement(e);

    const index: string = await this.__indexElement(e);

    this.data.set(index, e);
  }

  async loadElement(index: string) {
    if (!this.hasElement(index)) {
      await this.__loadElement(index);

      if (this.hasEvent(CollectionEvent.load)) {
        await this.getEvent(CollectionEvent.load)(this);
      }
    }
  }

  hasEvent(eventName: string) {
    return this._events.has(eventName);
  }

  getEvent(eventName: string) {
    return this._events.get(eventName) || (() => {});
  }

  setEvent(eventName: string, event: Function) {
    this._events.set(eventName, event);
  }

  getElement(index: string) {
    return this.data.get(index);
  }

  hasElement(index: string) {
    return this.data.has(index);
  }

  elementEquals(a: any, index: string = this.__indexElement(a)) {
    return this.__elementsAreEqual(a, this.getElement(index));
  }

  elementDiff(a: any, index: string = this.__indexElement(a)) {
    return this.__diffElement(a, this.getElement(index));
  }

  [Symbol.iterator]() {
    return this.data[Symbol.iterator]();
  }

  get data() {
    return this._data;
  }

  __validateElement(_e: any) {}

  abstract __loadAll(): Promise<any>;

  abstract __loadElement(index: string): Promise<any>;

  abstract __indexElement(e: any): string;

  __diffElement(a: any, b: any) {
    return fastJsonPatch.compare(a, b);
  }

  __elementsAreEqual(a: any, b: any) {
    return fastJsonPatch.compare(a, b).length === 0;
  }
}
