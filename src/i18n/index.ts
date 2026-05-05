// EN: i18next configuration. Two locales (zh-CN default, en-US fallback);
// language detected via localStorage > navigator > zh-CN. Loaded eagerly
// — both bundles are tiny (<3KB each) so there's no win from lazy split,
// and eager load keeps the toggle instant.
//
// 中: i18next 配置。两套 locale（默认 zh-CN，回退 en-US）；语言检测
// 顺序 localStorage > navigator > zh-CN。打包时直接 inline，因为 bundle
// 很小，懒加载没好处，eager 让切换瞬时生效。
//
// Storage key: `loomscope:lang` (matches the `loomscope:` prefix
// convention used by other localStorage entries).
//
// Adding strings: edit both locales/zh-CN.json and locales/en-US.json
// at the same path. `t('a.b.c')` resolves nested keys with dot
// notation. Missing-key fallback returns the key itself in dev so
// drift is visible.

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";

export const SUPPORTED_LANGUAGES = ["zh-CN", "en-US"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "loomscope:lang";

// EN: With inline `resources` (no backend), init resolves
// synchronously per i18next's contract — `initImmediate: false`
// promises that callers see translations immediately after init()
// returns, instead of waiting for a microtask. We export the init
// promise so test setup can `await` it before any render runs.
// 中: 当 resources 已 inline、没 backend 时，`initImmediate: false`
// 让 init 同步完成。同时 export init 返回的 Promise 给测试 setup
// 可 await，确保渲染前 i18n 已就绪。
export const i18nReady = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "zh-CN": { translation: zhCN },
      "en-US": { translation: enUS },
    },
    fallbackLng: "zh-CN",
    // EN: omit `supportedLngs` — i18next 26 behaviour with both
    // `supportedLngs` + LanguageDetector returning a non-listed code
    // (e.g. happy-dom navigator yielding plain "en") leaves
    // resolvedLanguage in a half-loaded state where t() returns the
    // key. Letting i18next freely pick from `resources` keys works.
    // Detection still respects fallbackLng for true unknowns.
    // 中: 不写 `supportedLngs`——v26 + detector 拿到不在白名单里
    // 的 code（如 happy-dom 的 'en'）时 t() 会返回 key 名；让
    // i18next 自由用 resources 里的 key 解析就 OK。
    interpolation: { escapeValue: false },
    // EN: disable Suspense — resources are inline (no async backend
    // load) so Suspense only adds a hydration-mismatch hazard.
    // 中: 关掉 Suspense——所有 resources 都 inline 同步就绪。
    react: { useSuspense: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

export default i18n;

// EN: Switch the active language and persist. Triggers a full app
// re-render via react-i18next's context.
// 中: 切换并持久化语言；通过 react-i18next 的 context 触发整个应用
// 重新渲染。
export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang);
}

// EN: Resolve the canonical app language from i18next's resolved
// language (which may be 'en' or a regional variant like 'en-GB').
// 中: 把 i18next 的 resolvedLanguage 归一化到我们支持的两个 code。
export function currentLanguage(): Language {
  const resolved = (i18n.resolvedLanguage ?? i18n.language ?? "zh-CN")
    .toLowerCase();
  if (resolved.startsWith("en")) return "en-US";
  return "zh-CN";
}
