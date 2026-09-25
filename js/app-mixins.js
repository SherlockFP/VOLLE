// App (js/main.js) keeps some features in their own files (js/app-*.js): each
// holds that feature's methods as a plain class whose methods are copied onto
// App.prototype once at load. `this` is the App instance as before; a name
// defined twice is a load-time error instead of a silent override.
export function mixinMethods(target, ...sources) {
    for (const source of sources) {
        for (const name of Object.getOwnPropertyNames(source.prototype)) {
            if (name === 'constructor') continue;
            if (Object.hasOwn(target.prototype, name)) throw new Error(`${target.name}.${name} is defined twice`);
            Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(source.prototype, name));
        }
    }
    return target;
}
