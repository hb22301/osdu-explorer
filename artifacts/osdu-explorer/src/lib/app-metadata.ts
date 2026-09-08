import packageJson from "../../package.json";

declare const __APP_PUBLISH_DATE__: string;

export const APP_VERSION = packageJson.version;
export const APP_PUBLISH_DATE = __APP_PUBLISH_DATE__;

export const APP_RELEASE_LABEL = `v${APP_VERSION} · Published ${APP_PUBLISH_DATE}`;