#!/usr/bin/env node

// Claude Code Custom Status Line — Context Bricks
// v4.0.0 - Cross-platform Node.js version (no jq/bash dependencies)
//
// Line 1: [Model:style] repo:branch status | @agent | wt
// Line 2: [commit] message | +lines/-lines
// Line 3: [■■■■□□□□] 73%! | 52k free | 2h15m | $12.50

const { execFileSync } = require('child_process');

// Read JSON from stdin
const chunks = [];
const stdin = process.stdin;
stdin.setEncoding('utf8');

if (stdin.isTTY) {
  process.exit(0);
}

stdin.on('data', (chunk) => chunks.push(chunk));
stdin.on('end', () => {
  try {
    main(JSON.parse(chunks.join('') || '{}'));
  } catch {
    main({});
  }
});

// ANSI helpers
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2;37m',
  cyan: '\x1b[1;36m',
  green: '\x1b[1;32m',
  blue: '\x1b[1;34m',
  yellow: '\x1b[1;33m',
  red: '\x1b[1;31m',
  magenta: '\x1b[1;35m',
  greenDim: '\x1b[0;32m',
  redDim: '\x1b[0;31m',
  yellowDim: '\x1b[0;33m',
  cyanDim: '\x1b[0;36m',
};

// Safe git command execution using execFileSync (no shell injection risk)
function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function main(data) {
  // Parse Claude data
  const model = (data.model?.display_name || 'Claude').replace('Claude ', '');
  const currentDir = data.workspace?.current_dir || process.env.PWD || process.cwd();
  const linesAdded = data.cost?.total_lines_added || 0;
  const linesRemoved = data.cost?.total_lines_removed || 0;
  const agentName = data.agent?.name || '';
  const outputStyle = data.output_style?.name || '';
  const exceeds200k = data.context_window?.exceeds_200k_tokens || false;

  // Style abbreviation
  let styleAbbrev = '';
  if (outputStyle && outputStyle !== 'default') {
    const map = { explanatory: 'expl', concise: 'conc', verbose: 'verb' };
    styleAbbrev = map[outputStyle] || outputStyle.slice(0, 4);
  }

  // Change to workspace directory
  try { process.chdir(currentDir); } catch { /* stay where we are */ }

  // Git info
  const isGit = git('rev-parse', '--git-dir') !== '';
  let repoName = '', branch = '', commitShort = '', commitMsg = '', gitStatus = '', inWorktree = false;

  if (isGit) {
    const toplevel = git('rev-parse', '--show-toplevel');
    repoName = toplevel ? toplevel.split('/').pop().split('\\').pop() : '';
    branch = git('branch', '--show-current') || 'detached';
    commitShort = git('rev-parse', '--short', 'HEAD');
    commitMsg = git('log', '-1', '--pretty=%s').slice(0, 50);

    // Worktree detection
    const gitDir = git('rev-parse', '--git-dir');
    inWorktree = gitDir.includes('/worktrees/') || gitDir.includes('\\worktrees\\');

    // Status
    const porcelain = git('status', '--porcelain');
    if (porcelain) gitStatus = '*';

    // Ahead/behind
    const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
    if (upstream) {
      const ahead = parseInt(git('rev-list', '--count', `${upstream}..HEAD`)) || 0;
      const behind = parseInt(git('rev-list', '--count', `HEAD..${upstream}`)) || 0;
      if (ahead > 0) gitStatus += `\u2191${ahead}`;
      if (behind > 0) gitStatus += `\u2193${behind}`;
    }
  }

  // ── Line 1: Session identity ──────────────────────────────
  let line1 = '';
  line1 += styleAbbrev
    ? `${c.cyan}[${model}:${styleAbbrev}]${c.reset}`
    : `${c.cyan}[${model}]${c.reset}`;

  if (repoName) {
    line1 += ` ${c.green}${repoName}${c.reset}`;
    if (branch) line1 += `:${c.blue}${branch}${c.reset}`;
  }

  if (gitStatus) line1 += ` ${c.red}${gitStatus}${c.reset}`;
  if (agentName) line1 += ` | ${c.magenta}@${agentName}${c.reset}`;
  if (inWorktree) line1 += ` | ${c.yellow}wt${c.reset}`;

  // ── Line 2: Git state ─────────────────────────────────────
  let line2 = '';
  if (commitShort) {
    line2 += `${c.dim}[${c.reset}${c.yellowDim}${commitShort}${c.reset}${c.dim}]${c.reset}`;
    if (commitMsg) line2 += ` ${commitMsg}`;
  }

  if (linesAdded > 0 || linesRemoved > 0) {
    if (line2) line2 += ' | ';
    line2 += `${c.greenDim}+${linesAdded}${c.reset}/${c.redDim}-${linesRemoved}${c.reset}`;
  }

  // ── Line 3: Context bricks + metrics ──────────────────────
  const durationMs = data.cost?.total_duration_ms || 0;
  const durationH = Math.floor(durationMs / 3600000);
  const durationM = Math.floor((durationMs % 3600000) / 60000);
  const costUsd = data.cost?.total_cost_usd || 0;
  const totalTokens = data.context_window?.context_window_size || 200000;

  let usagePct, freeTokens;
  const usedPctRaw = data.context_window?.used_percentage;
  const remainingPctRaw = data.context_window?.remaining_percentage;

  if (usedPctRaw != null) {
    usagePct = Math.floor(usedPctRaw);
    const remainingPct = Math.floor(remainingPctRaw || 0);
    freeTokens = Math.floor((totalTokens * remainingPct) / 100);
  } else {
    const cu = data.context_window?.current_usage;
    let usedTokens = 0;
    if (cu) {
      usedTokens = (cu.input_tokens || 0) + (cu.cache_creation_input_tokens || 0) + (cu.cache_read_input_tokens || 0);
    }
    freeTokens = totalTokens - usedTokens;
    usagePct = totalTokens > 0 ? Math.floor((usedTokens * 100) / totalTokens) : 0;
  }

  const freeK = Math.floor(freeTokens / 1000);

  // Brick bar (40 bricks)
  const totalBricks = 40;
  const usedBricks = totalTokens > 0 ? Math.floor((usagePct * totalBricks) / 100) : 0;
  const freeBricks = totalBricks - usedBricks;

  let line3 = '[';
  for (let i = 0; i < usedBricks; i++) line3 += `${c.cyanDim}\u25a0${c.reset}`;
  for (let i = 0; i < freeBricks; i++) line3 += `${c.dim}\u25a1${c.reset}`;
  line3 += ']';

  // Percentage — yellow with ! when exceeding 200k
  if (exceeds200k) {
    line3 += ` ${c.yellow}${usagePct}%!${c.reset}`;
  } else {
    line3 += ` ${c.bold}${usagePct}%${c.reset}`;
  }

  line3 += ` | ${c.green}${freeK}k free${c.reset}`;
  line3 += ` | ${durationH}h ${durationM}m`;

  if (costUsd > 0) {
    line3 += ` | ${c.yellowDim}$${costUsd.toFixed(2)}${c.reset}`;
  }

  // Output
  console.log(line1);
  console.log(line2);
  console.log(line3);
}
