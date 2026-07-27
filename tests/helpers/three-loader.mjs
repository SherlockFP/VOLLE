// tests/helpers/three-loader.mjs — redirects the bare specifier 'three' to tests/helpers/three-stub.mjs.
// Uses node:module's synchronous, same-thread registerHooks (Node 22.15+/23.5+/24+), so it works under a
// plain `node --test` invocation with no extra CLI flags (npm test runs exactly that).
// Call registerThreeStub() once, before dynamically import()-ing any module that (transitively) imports 'three'.
import { registerHooks } from 'node:module';

const STUB_URL = new URL('./three-stub.mjs', import.meta.url).href;

let registered = false;

export function registerThreeStub() {
    if (registered) return;
    registered = true;
    registerHooks({
        resolve(specifier, context, nextResolve) {
            if (specifier === 'three') {
                return { url: STUB_URL, shortCircuit: true };
            }
            return nextResolve(specifier, context);
        }
    });
}
