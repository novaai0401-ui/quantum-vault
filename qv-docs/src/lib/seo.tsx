// SPDX-License-Identifier: Apache-2.0
//
// Per-route <head> management with no dependency. Keeps title, description,
// canonical, Open Graph, Twitter and JSON-LD in sync with the route so that
// client-side navigation produces the same head a prerendered page carries.

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { SITE_NAME, SITE_URL, DEFAULT_DESCRIPTION, routeMeta } from './site';

export interface SeoProps {
  title?: string;
  description?: string;
  /** Extra JSON-LD objects appended to the page graph. */
  jsonLd?: Record<string, unknown>[];
  noindex?: boolean;
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function Seo({ title, description, jsonLd, noindex }: SeoProps) {
  const { pathname } = useLocation();
  const ldKey = jsonLd ? JSON.stringify(jsonLd) : '';

  useEffect(() => {
    const meta = routeMeta(pathname);
    const t = title ?? meta?.title ?? `${SITE_NAME} — post-quantum tokens`;
    const d = description ?? meta?.description ?? DEFAULT_DESCRIPTION;
    const canonical = SITE_URL + (pathname === '/' ? '/' : pathname.replace(/\/+$/, ''));

    document.title = t;
    upsertMeta('name', 'description', d);
    upsertMeta('property', 'og:title', t);
    upsertMeta('property', 'og:description', d);
    upsertMeta('property', 'og:url', canonical);
    upsertMeta('property', 'og:site_name', SITE_NAME);
    upsertMeta('name', 'twitter:title', t);
    upsertMeta('name', 'twitter:description', d);
    upsertMeta('name', 'robots', noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large');
    upsertLink('canonical', canonical);

    // JSON-LD: one script tag owned by the route, replaced on navigation.
    const id = 'qv-jsonld-route';
    document.getElementById(id)?.remove();
    if (ldKey) {
      const list = JSON.parse(ldKey) as Record<string, unknown>[];
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.id = id;
      s.textContent = JSON.stringify(list.length === 1 ? list[0] : { '@context': 'https://schema.org', '@graph': list });
      document.head.appendChild(s);
    }
  }, [pathname, title, description, ldKey, noindex]);

  return null;
}

/** BreadcrumbList JSON-LD helper. */
export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: SITE_URL + it.path,
    })),
  };
}

/** FAQPage JSON-LD helper. */
export function faqPage(qa: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/** TechArticle JSON-LD helper for storybook chapters and guides. */
export function techArticle(opts: { headline: string; description: string; path: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: opts.headline,
    description: opts.description,
    url: SITE_URL + opts.path,
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL + '/' },
    author: { '@type': 'Organization', name: 'Sigvault contributors', url: SITE_URL + '/about' },
    license: 'https://creativecommons.org/licenses/by/4.0/',
  };
}
