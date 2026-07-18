export class ObjectPool {
    constructor(create, reset, discard, max = 64) {
        this.create = create;
        this.reset = reset;
        this.discard = discard;
        this.max = max;
        this.items = [];
    }

    acquire() {
        return this.items.pop() || this.create();
    }

    release(item) {
        this.reset?.(item);
        if (this.items.length < this.max) this.items.push(item);
        else this.discard?.(item);
    }

    get size() {
        return this.items.length;
    }
}

