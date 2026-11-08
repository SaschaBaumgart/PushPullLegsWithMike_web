// Baut die zweisprachige Seite nach dist/.  Aufruf:  node build.mjs
// Keine Abhängigkeiten, nur Node.js (>= 18).
//
//   src/i18n/<lang>.json        Texte pro Sprache
//   src/templates/*.html        Seitengerüste mit {{platzhaltern}}
//   src/partials/*.html         wiederverwendete Teile ({{> name}})
//   src/content/<lang>/*.html   lange Texte als HTML ({{@name}}), z. B. Datenschutz
//   css/, images/, CNAME        werden unverändert nach dist/ kopiert

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const SITE = "https://pushpulllegswithmike.com";
const LANGS = ["de", "en"];
const DEFAULT_LANG = "en"; // x-default und Fallback
const LEGAL_PAGES = ["datenschutz_app", "datenschutz_web"];

const read = (...p) => readFileSync(join(...p), "utf8");
const write = (rel, content) => {
  const file = join(DIST, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// ---------- Texte laden und prüfen ----------

const i18n = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(SRC, "i18n", `${l}.json`))]));

function flatKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}
{
  const ref = new Set(flatKeys(i18n[DEFAULT_LANG]));
  for (const l of LANGS) {
    const keys = new Set(flatKeys(i18n[l]));
    const missing = [...ref].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !ref.has(k));
    if (missing.length || extra.length) {
      throw new Error(`i18n/${l}.json passt nicht zu ${DEFAULT_LANG}.json. Fehlt: [${missing}] Zuviel: [${extra}]`);
    }
  }
}

// ---------- Mini-Template-Engine ----------

function lookup(obj, path) {
  let cur = obj;
  for (const part of path.split(".")) {
    if (cur === undefined || cur === null) break;
    cur = cur[part];
  }
  return cur;
}

function render(template, ctx) {
  let out = template;

  // {{> partial}}  – Teilvorlagen (können selbst Platzhalter enthalten)
  out = out.replace(/\{\{>\s*([\w-]+)\s*\}\}\n?/g, (_, name) => {
    const file = join(SRC, "partials", `${name}.html`);
    if (!existsSync(file)) throw new Error(`Partial fehlt: ${name}`);
    return render(read(file), ctx);
  });

  // {{@name}} oder {{@$page}}  – Inhaltsfragment der aktuellen Sprache
  out = out.replace(/\{\{@\s*(\$?[\w-]+)\s*\}\}/g, (_, ref) => {
    const name = ref.startsWith("$") ? ctx.vars[ref.slice(1)] : ref;
    const file = join(SRC, "content", ctx.lang, `${name}.html`);
    if (!existsSync(file)) throw new Error(`Inhalt fehlt: content/${ctx.lang}/${name}.html`);
    return read(file);
  });

  // {{$variable}} und {{text.pfad}}
  out = out.replace(/\{\{\s*(\$?[\w.]+)\s*\}\}/g, (_, key) => {
    const value = key.startsWith("$") ? ctx.vars[key.slice(1)] : lookup(ctx.texts, key);
    if (typeof value !== "string") throw new Error(`Platzhalter {{${key}}} hat keinen Wert (Sprache: ${ctx.lang})`);
    return value;
  });

  return out;
}

// ---------- Hilfen ----------

// Seiten, die als Verzeichnis ausgeliefert werden (/<lang>/<dir>/), alle anderen als /<lang>/<name>.html
const PAGE_DIR = { index: "", beta: "beta/" };

const pageUrl = (lang, page) => (page in PAGE_DIR ? `/${lang}/${PAGE_DIR[page]}` : `/${lang}/${page}.html`);
const pageFile = (lang, page) => (page in PAGE_DIR ? `${lang}/${PAGE_DIR[page]}index.html` : `${lang}/${page}.html`);

const hreflangLinks = (page) =>
  [
    ...LANGS.map((l) => `  <link rel="alternate" hreflang="${l}" href="${SITE}${pageUrl(l, page)}">`),
    `  <link rel="alternate" hreflang="x-default" href="${SITE}${pageUrl(DEFAULT_LANG, page)}">`,
  ].join("\n");

function switcher(lang, page) {
  const items = LANGS.map((l) =>
    l === lang
      ? `<span aria-current="true">${l.toUpperCase()}</span>`
      : `<a href="${pageUrl(l, page)}" hreflang="${l}" lang="${l}">${l.toUpperCase()}</a>`
  );
  return `<span class="lang-switch" role="group" aria-label="${escAttr(i18n[lang].lang.label)}">${items.join(
    '<span aria-hidden="true">|</span>'
  )}</span>`;
}

// ---------- Bauen ----------

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Statische Dateien unverändert übernehmen
for (const name of ["css", "images", "CNAME"]) {
  if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(DIST, name), { recursive: true });
}

// Seiten pro Sprache
const pages = [
  { name: "index", template: "index", titleKey: "meta.title", describe: true },
  { name: "beta", template: "beta", titleKey: "beta.metaTitle", noindex: true },
  ...LEGAL_PAGES.map((name) => ({ name, template: "legal", titleKey: "meta.legalTitle", noindex: true })),
];

for (const lang of LANGS) {
  const texts = i18n[lang];
  for (const page of pages) {
    const vars = {
      lang,
      page: page.name,
      title: lookup(texts, page.titleKey),
      canonical: `${SITE}${pageUrl(lang, page.name)}`,
      hreflang: hreflangLinks(page.name),
      switch: switcher(lang, page.name),
      descriptionTag: page.describe ? `  <meta name="description" content="${escAttr(texts.meta.description)}">\n` : "",
      robotsTag: page.noindex ? `  <meta name="robots" content="noindex">\n` : "",
    };
    const html = render(read(SRC, "templates", `${page.template}.html`), { lang, texts, vars });
    write(pageFile(lang, page.name), html);
  }
}

// Weiterleitungen: / und /beta/ (Spracherkennung) und die alten Datenschutz-URLs
const redirects = [
  { file: "index.html", target: "", page: "index", noindex: false },
  { file: "beta/index.html", target: "beta/", page: "beta", noindex: true },
  ...LEGAL_PAGES.map((n) => ({ file: `${n}.html`, target: `${n}.html`, page: n, noindex: true })),
];
for (const r of redirects) {
  const vars = {
    target: r.target,
    hreflang: hreflangLinks(r.page),
    robotsTag: r.noindex ? `  <meta name="robots" content="noindex">\n` : "",
  };
  write(r.file, render(read(SRC, "templates", "redirect.html"), { lang: DEFAULT_LANG, texts: i18n[DEFAULT_LANG], vars }));
}

// sitemap.xml und robots.txt
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LANGS.map(
  (l) => `  <url>
    <loc>${SITE}${pageUrl(l, "index")}</loc>
${LANGS.map((a) => `    <xhtml:link rel="alternate" hreflang="${a}" href="${SITE}${pageUrl(a, "index")}"/>`).join("\n")}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${pageUrl(DEFAULT_LANG, "index")}"/>
  </url>`
).join("\n")}
</urlset>
`;
write("sitemap.xml", sitemap);
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`Fertig: dist/ (${LANGS.join(", ")}, ${pages.length} Seiten pro Sprache)`);
