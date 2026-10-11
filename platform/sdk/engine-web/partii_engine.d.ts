/* tslint:disable */
/* eslint-disable */

/**
 * The engine for web pages. One per page.
 */
export class WebEngine {
    free(): void;
    [Symbol.dispose](): void;
    create(game: string, max_members: number, kind: string, name: string, meta: string): number;
    join(code: string, kind: string, name: string, meta: string): number;
    leave(): void;
    /**
     * `config`: `{edge, key, conn?, client?, player_token?, no_webrtc?}` (JSON).
     */
    constructor(config: string);
    online(): boolean;
    static pathName(id: number): string;
    /**
     * Events since the last call, as a JSON array.
     */
    poll(): string;
    /**
     * Send bytes to a member (0xFFFF = everyone).
     */
    send(to: number, reliable: boolean, bytes: Uint8Array): void;
    /**
     * Link state per member, as JSON.
     */
    stats(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_webengine_free: (a: number, b: number) => void;
    readonly webengine_create: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly webengine_join: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly webengine_leave: (a: number) => void;
    readonly webengine_new: (a: number, b: number) => [number, number, number];
    readonly webengine_online: (a: number) => number;
    readonly webengine_pathName: (a: number) => [number, number];
    readonly webengine_poll: (a: number) => [number, number];
    readonly webengine_send: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly webengine_stats: (a: number) => [number, number];
    readonly wasm_bindgen_4a957859194b7c6___convert__closures_____invoke___wasm_bindgen_4a957859194b7c6___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_4a957859194b7c6___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_4a957859194b7c6___convert__closures_____invoke___web_sys_e24271b32680505d___features__gen_MessageEvent__MessageEvent______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4a957859194b7c6___convert__closures_____invoke___web_sys_e24271b32680505d___features__gen_MessageEvent__MessageEvent______true__2: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4a957859194b7c6___convert__closures_____invoke___web_sys_e24271b32680505d___features__gen_MessageEvent__MessageEvent______true__3: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4a957859194b7c6___convert__closures_____invoke_______true_: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
