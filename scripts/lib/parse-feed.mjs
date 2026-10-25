import { XMLParser } from "fast-xml-parser";
import { EXCERPT_CHARS, extractImageFromHtml, htmlToText, makeExcerpt, resolveHttpUrl } from "./html.mjs";
import { articleId } from "./snapshot.mjs";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  ignoreDeclaration: true,
});

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === "object") {
    if (node["#text"] != null) return textOf(node["#text"]);
  }
  return "";
}

export function toIso(value) {
  const raw = textOf(value).trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function firstText(item, keys) {
  for (const key of keys) {
    const value = textOf(item?.[key]).trim();
    if (value) return value;
  }
  return "";
}

function linkValue(node) {
  const links = asArray(node);
  const objects = links.filter((link) => link && typeof link === "object");
  if (objects.length) {
    const preferred = objects.find((link) => (link["@_rel"] || "alternate") === "alternate")
      || objects.find((link) => !["enclosure", "self", "replies", "hub"].includes(link["@_rel"]));
    if (preferred?.["@_href"]) return String(preferred["@_href"]).trim();
  }
  for (const link of links) {
    const text = typeof link === "string" ? link : textOf(link);
    if (text && text.trim()) return text.trim();
  }
  return "";
}

function guidText(node) {
  return textOf(node).trim();
}

function guidFallbackLink(node) {
  const value = guidText(node);
  if (!/^https?:\/\//i.test(value)) return "";
  if (node && typeof node === "object" && String(node["@_isPermaLink"] || "true").toLowerCase() === "false") {
    return "";
  }
  return value;
}

function isTiny(node) {
  if (!node || typeof node !== "object") return false;
  const width = Number(node["@_width"]);
  const height = Number(node["@_height"]);
  return (Number.isFinite(width) && width > 0 && width <= 2) || (Number.isFinite(height) && height > 0 && height <= 2);
}

function isImageCandidate(url, type, medium) {
  const hint = `${type || ""} ${medium || ""}`.toLowerCase();
  if (/audio|video|pdf/.test(hint) && !/image/.test(hint)) return false;
  if (/image/.test(hint)) return true;
  return /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i.test(String(url).split("?")[0]);
}

function collectMedia(item) {
  const nodes = [];
  const take = (node) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "media:content" || key === "media:thumbnail" || key === "enclosure") {
        nodes.push(...asArray(value));
      } else if (key === "media:group") {
        for (const child of asArray(value)) take(child);
      }
    }
  };
  take(item);
  return nodes;
}

function imageFromMedia(nodes, base) {
  for (const node of nodes) {
    if (isTiny(node)) continue;
    if (typeof node === "string") {
      if (!isImageCandidate(node, "", "")) continue;
      const resolved = resolveHttpUrl(node, base);
      if (resolved) return resolved;
      continue;
    }
    const url = node["@_url"] || node["@_href"] || "";
    const type = node["@_type"] || "";
    const medium = node["@_medium"] || "";
    if (!isImageCandidate(url, type, medium)) continue;
    const resolved = resolveHttpUrl(url, base);
    if (resolved) return resolved;
  }
  return null;
}

function imageFromAtomLinks(linkNode, base) {
  for (const link of asArray(linkNode)) {
    if (!link || typeof link !== "object") continue;
    const rel = link["@_rel"] || "";
    if (rel !== "enclosure" && rel !== "related") continue;
    const url = link["@_href"] || "";
    const type = link["@_type"] || "";
    if (!isImageCandidate(url, type, "")) continue;
    const resolved = resolveHttpUrl(url, base);
    if (resolved) return resolved;
  }
  return null;
}

function choosePlainText(rawParts) {
  let best = "";
  for (const part of rawParts) {
    const plain = htmlToText(part);
    if (plain.length > best.length) best = plain;
  }
  return best;
}

function chooseExcerpt(fullText, rawParts) {
  const flatFull = fullText.replace(/\s+/g, " ").trim();
  const teasers = rawParts
    .map((part) => htmlToText(part).replace(/\s+/g, " ").trim())
    .filter((plain) => plain.length >= 40 && plain.length < flatFull.length)
    .filter((plain) => !flatFull.startsWith(plain.slice(0, Math.min(60, plain.length))));
  const shortEnough = teasers.filter((plain) => plain.length <= EXCERPT_CHARS);
  if (shortEnough.length) {
    shortEnough.sort((a, b) => b.length - a.length);
    return makeExcerpt(shortEnough[0]);
  }
  if (teasers.length) {
    teasers.sort((a, b) => a.length - b.length);
    return makeExcerpt(teasers[0]);
  }
  return makeExcerpt(fullText);
}

function buildArticle({ title, link, guid, rawParts, imageUrl, publishedRaw, feed }) {
  const cleanTitle = htmlToText(title).replace(/\s+/g, " ").trim();
  const absolute = resolveHttpUrl(link, feed.url);
  if (!cleanTitle || !absolute) return null;
  const fullText = choosePlainText(rawParts);
  const htmlImage = rawParts.map((part) => extractImageFromHtml(part, absolute)).find(Boolean) || null;
  return {
    id: articleId(absolute, guid),
    title: cleanTitle,
    excerpt: chooseExcerpt(fullText, rawParts),
    fullText,
    imageUrl: imageUrl || htmlImage,
    publishedAt: toIso(publishedRaw),
    source: feed.name,
    sourceFeed: feed.id,
    link: absolute,
  };
}

function fromItem(item, feed) {
  const rawParts = [
    textOf(item["content:encoded"]),
    textOf(item["content"]),
    textOf(item.description),
    textOf(item.summary),
  ].filter((part) => part && part.trim());
  const link = linkValue(item.link) || guidFallbackLink(item.guid) || guidFallbackLink(item.id);
  const base = resolveHttpUrl(link, feed.url) || feed.url;
  return buildArticle({
    title: textOf(item.title),
    link,
    guid: guidText(item.guid) || guidText(item.id),
    rawParts,
    imageUrl: imageFromMedia(collectMedia(item), base) || imageFromAtomLinks(item.link, base),
    publishedRaw: firstText(item, ["pubDate", "published", "dc:date", "date", "updated", "lastUpdated"]),
    feed,
  });
}

function findItems(doc) {
  const rssChannel = asArray(doc?.rss?.channel)[0];
  const rssItems = asArray(rssChannel?.item);
  if (rssItems.length) return rssItems;
  const atomEntries = asArray(doc?.feed?.entry);
  if (atomEntries.length) return atomEntries;
  const rdf = doc?.["rdf:RDF"] || doc?.RDF;
  const rdfItems = asArray(rdf?.item);
  if (rdfItems.length) return rdfItems;
  return [];
}

export function parseFeedXml(xml, feed) {
  const doc = parser.parse(String(xml).replace(/^\uFEFF/, ""));
  if (!doc || typeof doc !== "object") throw new Error("empty feed document");
  const items = findItems(doc);
  if (!items.length) throw new Error("feed contained no items");
  const articles = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const article = fromItem(item, feed);
    if (article?.id) articles.push(article);
  }
  if (!articles.length) throw new Error("feed items had no usable title and link");
  return articles;
}
