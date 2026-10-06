import { GRAFANA_URL } from '../../hooks/useFireworksLive';

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-3 text-[15px] leading-relaxed text-[#001F3F]/75 last:mb-0 dark:text-white/70">{children}</p>
);

const Link = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-[#001F3F] underline dark:text-white">
    {children}
  </a>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-[#001F3F]/[0.06] px-1 py-0.5 font-mono text-[13px] text-[#001F3F]/85 dark:bg-white/10 dark:text-white/85">
    {children}
  </code>
);

/** Writeup - the engineering decisions behind the page, in two paragraphs. */
const Writeup = () => (
  <div>
    <P>
      This project doesn't use a real file system; the code is stored as strings in the web client. SGLang serves
      Qwen3-Coder, which runs tool calls (<Code>--tool-call-parser qwen3_coder</Code>) to understand the codebase and
      complete the task. SGLang was chosen because radix attention reuses the codebase as a prefix, giving over 90%
      cached prompt tokens. There is no build step and no idempotency; production would want both.
    </P>
    <P>
      A rented GPU cannot run all day, so the endpoint scales to zero and Supabase triggers cap each address at three
      inputs and the site at forty runs a day. Cold start is a design choice given those costs. Two flags trim it:{' '}
      <Code>SGLANG_ENABLE_JIT_DEEPGEMM=0</Code> skips a slow JIT pre-compile that single-request serving does not
      need, and <Code>--cuda-graph-max-bs-decode 8</Code> captures graphs only up to batch size eight.
    </P>
    <P>
      Prometheus scrapes SGLang's own counters: time to first token, inter-token latency, cache hit rate, throughput
      and KV cache usage.
      {GRAFANA_URL && (
        <>
          {' '}
          <Link href={GRAFANA_URL}>Watch the engine live in Grafana!</Link>
        </>
      )}
    </P>
  </div>
);

export default Writeup;
