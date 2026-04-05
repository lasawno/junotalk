/* @ts-self-types="./codegen.d.ts" */

/**
 * @param {number} seed
 * @returns {number}
 */
function generate_code(seed) {
    const ret = wasm.generate_code(seed);
    return ret >>> 0;
}
exports.generate_code = generate_code;

/**
 * @param {Uint8Array} chars
 * @returns {number}
 */
function hash_username(chars) {
    const ptr0 = passArray8ToWasm0(chars, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hash_username(ptr0, len0);
    return ret >>> 0;
}
exports.hash_username = hash_username;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
    };
    return {
        __proto__: null,
        "./codegen_bg.js": import0,
    };
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/codegen_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
