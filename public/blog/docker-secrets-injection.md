# Your Agentic Coding Tool is *Reading* Your Secrets

[Back to Blog](/blog)
            Agentic AI Engineering

Why your coding agent should never see your secrets — and how Docker makes that possible.

Author: Nikhil Kulkarni

May 20, 2026 3 min read Docker Security LLM Agents Vibe Coding DevOps [01 · The Problem](#s1) [02 · The Fix](#s2) [03 · Caveats](#s3)

Every session with an agentic coding tool — Claude Code, Cursor, Copilot, all of them — is systematically insecure in a way most developers haven't thought through.

When these tools explore your codebase, every file they read gets sent to the provider's servers as context. That includes your `.env` file, hardcoded VM IPs, internal URLs, API keys, and passwords.

Section 01

## The Problem

They do this silently inside large toolcalls using standard shell commands like `cat`, `grep -r`, `find`, and `printenv` — completely normal parts of how coding agents navigate a project. Some of this data can be rotated if it leaks: a new API key takes thirty seconds. But some of it can't — your server IP, your personal information, your internal infrastructure. These live in your codebase because your application needs them. There's no reason they need to be stored on a third-party AI provider's servers indefinitely.

secret exposure — two scenarios
      
            ✗ hardcoded / grepped
          
            $ grep -r "password" .
          
            $ cat .env
          
            DB_PASS=s3cr3t! 
            API_KEY=sk-abc123 
            VM_IP=192.168.1.1
          ↑ sent to LLM servers stored forever
            ✓ injected
          
            docker run \   --env-file secrets.env
          
            ssh ${VM_IP} 
            curl -H "key: ${API_KEY}" 
            psql ${DB_URL}
          ⟳ LLM sees names only values stay local unsafe path safe path Agent runs grep -r to find credentials in the codebase… click to pause Section 02

## The Fix

The solution is simpler than it sounds, and you don't need anything beyond Docker Desktop or OrbStack. Run your coding agent inside a Docker container and inject all sensitive values as environment variables at container launch via `--env-file` — a file that lives entirely outside your codebase. The codebase the agent works on is completely clean: no real secrets, no hardcoded values, nothing to find and transmit. The agent still has full access to do everything it needs — SSH into a server, authenticate with an API, connect to a database — because the values exist as process-level environment variables, not as files on disk.

docker run — --env-file

```
# secrets.env lives outside the repo, never committed
docker run \
  --env-file /path/outside/repo/secrets.env \
  --mount type=bind,source=$(pwd),target=/workspace \
  my-agent-image

# Agent references names, never values:
#   ssh ${VM_IP}                        ← not  ssh 192.168.1.1
#   curl -H "Authorization: ${API_KEY}" ← not  curl -H "Authorization: sk-abc123"
#   psql ${DB_URL}                      ← not  psql postgresql://user:pass@host/db
```

injection flow — secrets never in the repo
    
        secrets.envoutside repo →
        docker run--env-file →
        containerprocess env vars ↓
        ${API_KEY}
      
        ${DB_URL}
      
        ${VM_IP}
      ↓
        agent ✓sees names only →
        LLM promptno real values →
        Anthropic / OpenAIharmless log
      bind mount keeps host files in sync — edits persist, nothing is copied

Critically, the container uses a bind mount, meaning the agent edits the exact same files on your host machine in real time: your `PLAN.md` gets updated, your code changes persist, your `CLAUDE.md` and memory files are all live and valid across sessions. Nothing is lost, nothing is copied — the container and your local machine share the same filesystem.

Corporations already do a higher-level version of this: secrets are injected at runtime from vaults like AWS Secrets Manager or HashiCorp Vault, scoped per service, never stored as files anywhere. For vibecoders, the Docker `--env-file` approach is the right level of this same thoughtfulness.

Section 03

## Caveats

This setup is not a silver bullet, and knowing where it breaks is as important as knowing how it works. The biggest surface-level gap: direct commands like `printenv`, `env`, and `set` dump everything injected into the process. Block these explicitly in `.claude/settings.json` using Claude Code's native permissions system:

.claude/settings.json

```
{
  "permissions": [
    { "type": "deny", "tool": "Bash(printenv*)" },
    { "type": "deny", "tool": "Bash(env*)" },
    { "type": "deny", "tool": "Bash(set*)" }
  ]
}
```

You can reinforce this with a rule in `CLAUDE.md` instructing the agent never to print environment variable values — but the `settings.json` block is the enforceable one. The deeper gap is harder to close: if the agent writes or runs a script that logs its own environment to stdout — a Python script with `print(os.environ.items())`, a Node script with `console.log(process.env)` — that output comes back as a tool result, lands in the model's context, and reaches Anthropic's servers anyway. The Docker boundary doesn't help here.

⚠ Warning — **The deny rules reduce the risk for direct shell commands, but can't intercept subprocess stdout.** This approach meaningfully shrinks the attack surface; it doesn't eliminate it entirely.

For a tighter boundary, Claude Code's native sensitive config and PreToolUse hooks (see: *nopeek*) can scrub matched patterns before they ever reach the model — worth researching if you need the next level. The second caveat is simpler: don't run your agent in auto-accept mode as a habit. Confirmation prompts exist for a reason. Treat them as a feature.

The extra hour of setup is the difference between your infrastructure living on someone else's servers forever and it never being there at all.

viewing now
      Views Likes Comments [Back to Blog](/blog)
