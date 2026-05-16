import { spawnSync } from 'node:child_process'

const isWin = process.platform === 'win32'
const windowsShell = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
const prettierExtensions = new Set([
  '.js',
  '.jsx',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
  '.cts',
  '.mts',
  '.json',
  '.css',
  '.scss',
  '.html',
  '.md',
  '.yaml',
  '.yml'
])

const runners = [
  {
    probe: 'bun',
    run(command) {
      return `bun ${command}`
    }
  }
]

const checks = [
  {
    name: 'Format Check',
    command: 'prettier --check',
    stagedOnly: true,
    help: 'Formatting issues were reported above. Review the listed files and fix them before committing again.'
  },
  {
    name: 'Lint Check',
    command: 'run lint:check',
    help: 'Lint errors were reported above. Review them and fix the affected code before committing again.'
  },
  {
    name: 'Type Check',
    command: 'run typecheck',
    help: 'Type errors were reported above. Review them and fix the affected code before committing again.'
  }
]

function spawnCommand(command, { stdio = 'inherit' } = {}) {
  if (isWin) {
    return spawnSync(windowsShell, ['/d', '/s', '/c', command], {
      cwd: process.cwd(),
      stdio
    })
  }

  return spawnSync('sh', ['-lc', command], {
    cwd: process.cwd(),
    stdio
  })
}

function shellQuote(value) {
  if (isWin) return `"${value.replace(/"/g, '\\"')}"`
  return `'${value.replace(/'/g, "'\\''")}'`
}

function stagedPrettierFiles() {
  const result = spawnCommand('git diff --cached --name-only --diff-filter=ACMR', {
    stdio: 'pipe'
  })
  if (result.error || result.status !== 0) return []

  return result.stdout
    .toString()
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => prettierExtensions.has(file.slice(file.lastIndexOf('.'))))
}

function commandExists(command) {
  const probe = isWin ? `where ${command}` : `command -v ${command}`
  const result = spawnCommand(probe, { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function printDivider() {
  console.log('========================================')
}

const runner = runners.find(({ probe }) => commandExists(probe))

if (!runner) {
  console.error('[pre-commit] Unable to find bun in PATH.')
  process.exit(1)
}

printDivider()
console.log('[pre-commit] Running checks before commit')
printDivider()

for (const check of checks) {
  console.log(`\n[pre-commit] ${check.name}`)
  let command = runner.run(check.command)
  if (check.stagedOnly) {
    const files = stagedPrettierFiles()
    if (files.length === 0) {
      console.log(`[pre-commit] ${check.name} skipped; no staged files require prettier.`)
      continue
    }
    command = `${command} ${files.map(shellQuote).join(' ')}`
  }
  const result = spawnCommand(command)

  if (result.error) {
    console.error(`\n[pre-commit] Failed to run "${check.command}".`)
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    console.error(`\n[pre-commit] ${check.name.toUpperCase()} FAILED`)
    console.error(`[pre-commit] ${check.help}`)
    console.error('[pre-commit] Commit aborted.')
    process.exit(result.status ?? 1)
  }

  console.log(`[pre-commit] ${check.name} passed.`)
}

console.log('\n[pre-commit] All checks passed. Proceeding with commit.')
