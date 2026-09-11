import { useMemo } from 'react';
import type { CorpusFile } from './types';

interface PreviewProps {
  fileMap: Map<string, CorpusFile>;
}

/**
 * Preview - the corpus frontend, rendered live from the visitor's local state.
 *
 * The corpus frontend is deliberately buildless (plain HTML, CSS and inline
 * SVG), so the page it produces can be assembled here by string substitution
 * and handed to an iframe with no bundler, no server and no build step. That
 * matters for more than convenience: a build step between the model's output
 * and the pixels would add latency to the very thing this page is measuring.
 *
 * Nothing is simulated on this side. All three of the corpus's scripts run
 * as written, so an edit to any of them shows up here. The backend is not
 * running, and the corpus's own API client knows that: its health check fails
 * and it falls back to the scripted demo job it ships with. That fallback is
 * the corpus's, not ours.
 *
 * The iframe is sandboxed without same-origin, so the model's JavaScript can
 * touch nothing but its own document. The one thing that sandbox takes away
 * that a real page would have is storage, so an in-memory stand-in is
 * provided; otherwise a theme toggle that remembers itself would throw.
 */
const Preview = ({ fileMap }: PreviewProps) => {
  const srcDoc = useMemo(() => {
    const html = fileMap.get('frontend/index.html')?.text ?? '';
    const css = fileMap.get('frontend/style.css')?.text ?? '';
    if (!html) return '';

    const storageShim = `
      try { window.localStorage.length; } catch {
        const store = new Map();
        const memory = {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
          clear: () => store.clear(),
          key: (i) => [...store.keys()][i] ?? null,
          get length() { return store.size; },
        };
        Object.defineProperty(window, 'localStorage', { value: memory });
        Object.defineProperty(window, 'sessionStorage', { value: memory });
      }
    `;

    // Inline the stylesheet and the scripts in the order index.html loads them.
    // Closing script tags inside a body are split so they cannot end the wrapper.
    const inline = (path: string) => `<script>${(fileMap.get(path)?.text ?? '').replace(/<\/script/gi, '<\\/script')}</script>`;
    return html
      .replace('<link rel="stylesheet" href="style.css" />', `<style>${css}</style>`)
      .replace('<script src="robot.js"></script>', `<script>${storageShim}</script>${inline('frontend/robot.js')}`)
      .replace('<script src="api.js"></script>', inline('frontend/api.js'))
      .replace('<script src="animate.js"></script>', inline('frontend/animate.js'));
  }, [fileMap]);

  if (!srcDoc) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#001F3F]/40 dark:text-white/40">
        No preview available
      </div>
    );
  }

  return (
    <iframe
      title="DocScribe preview"
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-white"
    />
  );
};

export default Preview;
