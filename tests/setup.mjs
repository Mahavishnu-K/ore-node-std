import { URL, URLSearchParams } from '../whatwg_url.js';
import * as oreHttp from '../http.js';

globalThis.URL = URL;
globalThis.URLSearchParams = URLSearchParams;
globalThis.fetch = oreHttp.fetch;
