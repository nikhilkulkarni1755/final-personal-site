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
 */
const Preview = ({ fileMap }: PreviewProps) => {
  const srcDoc = useMemo(() => {
    const html = fileMap.get('frontend/index.html')?.text ?? '';
    const css = fileMap.get('frontend/style.css')?.text ?? '';
    const robot = fileMap.get('frontend/robot.js')?.text ?? '';
    if (!html) return '';

    // Inline the stylesheet and the illustration, then drive the robot through
    // its phases on a loop. The corpus backend is not running here, so api.js
    // and animate.js are replaced by this small phase cycler.
    const phaseCycler = `
      const stage = document.getElementById('stage');
      const caption = document.getElementById('phase-caption');
      const detail = document.getElementById('phase-detail');
      const bar = document.getElementById('progress-bar');
      const script = [
        ['reading', 'opening document', 0.15],
        ['thinking', 'summarizing chunk 2/3', 0.55],
        ['writing', 'merging summaries', 0.95],
        ['done', 'summary ready', 1]
      ];
      let step = 0;
      const tick = () => {
        const [phase, text, progress] = script[step % script.length];
        stage.dataset.phase = phase;
        caption.textContent = phase;
        detail.textContent = text;
        bar.style.width = (progress * 100) + '%';
        step += 1;
      };
      tick();
      setInterval(tick, 2200);
    `;

    return html
      .replace('<link rel="stylesheet" href="style.css" />', `<style>${css}</style>`)
      .replace(
        /<script src="robot\.js"><\/script>[\s\S]*?<script src="animate\.js"><\/script>/,
        `<script>${robot}</script><script>
           window.DocScribeRobot.mountRobot(document.querySelector('.robot-slot'));
           ${phaseCycler}
         </script>`,
      );
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
