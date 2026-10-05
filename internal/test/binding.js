import uv from "../../internal_binding/uv.js";

export function internalBinding(mod) {
    if (mod === "uv") {
        return uv;
    }
}