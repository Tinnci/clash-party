import fs from 'fs'
import AdmZip from 'adm-zip'
import path from 'path'
import zlib from 'zlib'
import { extract } from 'tar'
import { execSync } from 'child_process'
import { pipeline } from 'stream/promises'

const cwd = process.cwd()
const TEMP_DIR = path.join(cwd, 'node_modules/.temp')
let arch = process.arch
const platform = process.platform
if (process.argv.slice(2).length !== 0) {
  arch = process.argv.slice(2)[0].replace('--', '')
}

function env(name, fallback) {
  return process.env[name] || fallback
}

function envList(name, fallback) {
  return env(name, fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function envNumber(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function authHeaders() {
  const token = process.env.CORE_DOWNLOAD_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function replaceFile(sourcePath, targetPath) {
  fs.rmSync(targetPath, { force: true })
  fs.renameSync(sourcePath, targetPath)
}

function replaceDir(sourcePath, targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true })
  fs.renameSync(sourcePath, targetPath)
}

async function fetchWithRetry(url, options = {}, retries = envNumber('PREPARE_FETCH_RETRIES', 3)) {
  let lastError
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options)
      if (response.ok) return response
      lastError = new Error(`${response.status} ${response.statusText}`)
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      lastError = error
    }
    if (attempt < retries) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000))
  }
  throw lastError
}

async function fetchText(url) {
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: authHeaders()
  })
  return response.text()
}

function githubReleaseApiUrl(releaseUrlPrefix) {
  const match = releaseUrlPrefix.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/?$/
  )
  if (!match) return ''
  const [, owner, repo, tag] = match
  return `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`
}

async function inferVersionFromReleaseAssets(releaseUrlPrefix, artifactBaseName) {
  const apiUrl = githubReleaseApiUrl(releaseUrlPrefix)
  if (!apiUrl) {
    throw new Error(`cannot infer version from non-GitHub release prefix: ${releaseUrlPrefix}`)
  }
  const response = await fetchWithRetry(apiUrl, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json', ...authHeaders() }
  })
  const release = await response.json()
  const asset = release.assets?.find((item) => {
    const name = item.name || ''
    return (
      name.startsWith(`${artifactBaseName}-`) &&
      (name.endsWith('.zip') || name.endsWith('.gz') || name.endsWith('.tgz'))
    )
  })
  if (!asset) throw new Error(`no release asset found for ${artifactBaseName}`)
  return asset.name
    .replace(`${artifactBaseName}-`, '')
    .replace(/\.zip$/, '')
    .replace(/\.gz$/, '')
    .replace(/\.tgz$/, '')
}

async function resolveVersion({
  explicitVersion,
  versionUrl,
  releaseUrlPrefix,
  artifactBaseName,
  label
}) {
  if (explicitVersion) return explicitVersion
  try {
    return (await fetchText(versionUrl)).trim()
  } catch (error) {
    console.warn(`[WARN]: failed to fetch ${label} version.txt: ${error.message}`)
  }
  const inferred = await inferVersionFromReleaseAssets(releaseUrlPrefix, artifactBaseName)
  console.log(`[INFO]: inferred ${label} version from release assets: ${inferred}`)
  return inferred
}

/* ======= mihomo cores ======= */
const OWN_CORE_RELEASE_TAG = env('OWN_CORE_RELEASE_TAG', 'Prerelease-Alpha')
const OWN_CORE_RELEASE_PREFIX = env(
  'OWN_CORE_RELEASE_PREFIX',
  `https://github.com/Tinnci/mihomo/releases/download/${OWN_CORE_RELEASE_TAG}`
)
const OWN_CORE_VERSION_URL = env('OWN_CORE_VERSION_URL', `${OWN_CORE_RELEASE_PREFIX}/version.txt`)

const STANDARD_CORE_MAP = {
  'win32-x64': 'mihomo-windows-amd64-compatible',
  'win32-ia32': 'mihomo-windows-386',
  'win32-arm64': 'mihomo-windows-arm64',
  'darwin-x64': 'mihomo-darwin-amd64-compatible',
  'darwin-arm64': 'mihomo-darwin-arm64',
  'linux-x64': 'mihomo-linux-amd64-compatible',
  'linux-arm64': 'mihomo-linux-arm64'
}

const GO120_CORE_MAP = {
  'win32-x64': 'mihomo-windows-amd64-v2-go120',
  'win32-ia32': 'mihomo-windows-386-go120',
  'win32-arm64': 'mihomo-windows-arm64',
  'darwin-x64': 'mihomo-darwin-amd64-v2-go120',
  'darwin-arm64': 'mihomo-darwin-arm64',
  'linux-x64': 'mihomo-linux-amd64-v2-go120',
  'linux-arm64': 'mihomo-linux-arm64'
}

function exactReleasePrefix(channelEnvPrefix) {
  return env(
    `${channelEnvPrefix}_RELEASE_URL_PREFIX`,
    env(`${channelEnvPrefix}_URL_PREFIX`, OWN_CORE_RELEASE_PREFIX)
  )
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

function appendVersionToLegacyPrefix(prefix, version) {
  const cleanPrefix = trimTrailingSlash(prefix)
  if (/\/releases\/download\/[^/]+$/i.test(cleanPrefix)) return cleanPrefix
  if (/\/releases\/download$/i.test(cleanPrefix)) return `${cleanPrefix}/${version}`
  return cleanPrefix
}

function downloadReleasePrefix(channel) {
  const exactPrefix = process.env[`${channel.envPrefix}_RELEASE_URL_PREFIX`]
  if (exactPrefix) return trimTrailingSlash(exactPrefix)

  const legacyPrefix = process.env[`${channel.envPrefix}_URL_PREFIX`]
  if (legacyPrefix) return appendVersionToLegacyPrefix(legacyPrefix, channel.version)

  return trimTrailingSlash(channel.releasePrefix)
}

function coreMap(channelEnvPrefix) {
  return env(`${channelEnvPrefix}_NAME_FLAVOR`, 'standard') === 'go120'
    ? GO120_CORE_MAP
    : STANDARD_CORE_MAP
}

const CORE_CHANNELS = {
  mihomo: {
    label: 'mihomo',
    envPrefix: 'MIHOMO',
    targetName: 'mihomo',
    version: '',
    get versionUrl() {
      return env('MIHOMO_VERSION_URL', OWN_CORE_VERSION_URL)
    },
    get releasePrefix() {
      return exactReleasePrefix('MIHOMO')
    },
    get artifactMap() {
      return coreMap('MIHOMO')
    }
  },
  alpha: {
    label: 'mihomo-alpha',
    envPrefix: 'MIHOMO_ALPHA',
    targetName: 'mihomo-alpha',
    version: '',
    get versionUrl() {
      return env('MIHOMO_ALPHA_VERSION_URL', OWN_CORE_VERSION_URL)
    },
    get releasePrefix() {
      return exactReleasePrefix('MIHOMO_ALPHA')
    },
    get artifactMap() {
      return coreMap('MIHOMO_ALPHA')
    }
  },
  smart: {
    label: 'mihomo-smart',
    envPrefix: 'MIHOMO_SMART',
    targetName: 'mihomo-smart',
    version: '',
    get versionUrl() {
      return env('MIHOMO_SMART_VERSION_URL', OWN_CORE_VERSION_URL)
    },
    get releasePrefix() {
      return exactReleasePrefix('MIHOMO_SMART')
    },
    get artifactMap() {
      return coreMap('MIHOMO_SMART')
    }
  }
}

async function resolveCoreVersion(channel) {
  const artifactBaseName = channel.artifactMap[`${platform}-${arch}`]
  try {
    channel.version = await resolveVersion({
      explicitVersion: process.env[`${channel.envPrefix}_VERSION`] || process.env.OWN_CORE_VERSION,
      versionUrl: channel.versionUrl,
      releaseUrlPrefix: channel.releasePrefix,
      artifactBaseName,
      label: channel.label
    })
    console.log(`[INFO]: ${channel.label} source: ${downloadReleasePrefix(channel)}`)
    console.log(`[INFO]: latest ${channel.label} version: ${channel.version}`)
  } catch (error) {
    throw new Error(`Error fetching ${channel.label} version: ${error.message}`)
  }
}

/*
 * check available
 */
for (const channel of Object.values(CORE_CHANNELS)) {
  if (!channel.artifactMap[`${platform}-${arch}`]) {
    throw new Error(`unsupported platform "${platform}-${arch}" for ${channel.label}`)
  }
}

/**
 * core info
 */
function coreSidecar(channel) {
  const name = channel.artifactMap[`${platform}-${arch}`]
  const isWin = platform === 'win32'
  const urlExt = isWin ? 'zip' : 'gz'
  const downloadURL = `${downloadReleasePrefix(channel)}/${name}-${channel.version}.${urlExt}`
  const exeFile = `${name}${isWin ? '.exe' : ''}`
  const zipFile = `${name}-${channel.version}.${urlExt}`

  return {
    name: channel.targetName,
    targetFile: `${channel.targetName}${isWin ? '.exe' : ''}`,
    exeFile,
    zipFile,
    downloadURL
  }
}
/**
 * download sidecar and rename
 */
async function resolveSidecar(binInfo) {
  const { name, targetFile, zipFile, exeFile, downloadURL } = binInfo

  const sidecarDir = path.join(cwd, 'extra', 'sidecar')
  const sidecarPath = path.join(sidecarDir, targetFile)
  const nextSidecarPath = path.join(sidecarDir, `${targetFile}.download`)

  fs.mkdirSync(sidecarDir, { recursive: true })
  const tempDir = path.join(TEMP_DIR, name)
  const tempZip = path.join(tempDir, zipFile)

  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.mkdirSync(tempDir, { recursive: true })
  try {
    if (!fs.existsSync(tempZip)) {
      await downloadFile(downloadURL, tempZip, { atomic: true })
    }

    if (zipFile.endsWith('.zip')) {
      const zip = new AdmZip(tempZip)
      zip.getEntries().forEach((entry) => {
        console.log(`[DEBUG]: "${name}" entry name`, entry.entryName)
      })
      zip.extractAllTo(tempDir, true)
      const extractedExe = findExtractedFile(tempDir, exeFile)
      if (!extractedExe) {
        throw new Error(`expected executable "${exeFile}" not found in ${tempDir}`)
      }
      fs.renameSync(extractedExe, nextSidecarPath)
      console.log(`[INFO]: "${name}" unzip finished`)
    } else if (zipFile.endsWith('.tgz')) {
      // tgz
      fs.mkdirSync(tempDir, { recursive: true })
      await extract({
        cwd: tempDir,
        file: tempZip
      })
      const files = fs.readdirSync(tempDir)
      console.log(`[DEBUG]: "${name}" files in tempDir:`, files)
      const extractedFilePath = findExtractedFile(tempDir, exeFile)
      if (extractedFilePath) {
        fs.renameSync(extractedFilePath, nextSidecarPath)
        console.log(`[INFO]: "${name}" file renamed to "${nextSidecarPath}"`)
        fs.chmodSync(nextSidecarPath, 0o755)
        console.log(`[INFO]: "${name}" chmod binary finished`)
      } else {
        throw new Error(`Expected file not found in ${tempDir}`)
      }
    } else {
      // gz
      const readStream = fs.createReadStream(tempZip)
      const writeStream = fs.createWriteStream(nextSidecarPath)
      await pipeline(readStream, zlib.createGunzip(), writeStream)
      console.log(`[INFO]: "${name}" gunzip finished`)
      fs.chmodSync(nextSidecarPath, 0o755)
      console.log(`[INFO]: "${name}" chmod binary finished`)
    }

    replaceFile(nextSidecarPath, sidecarPath)
    console.log(`[INFO]: "${name}" sidecar ready: ${sidecarPath}`)
  } catch (err) {
    fs.rmSync(nextSidecarPath, { force: true })
    throw err
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function findExtractedFile(dir, expectedName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findExtractedFile(fullPath, expectedName)
      if (found) return found
    } else if (entry.name === expectedName || entry.name.replace(/\.exe$/, '') === expectedName) {
      return fullPath
    }
  }
  return ''
}

/**
 * download the file to the extra dir
 */
async function resolveResource(binInfo) {
  const { file, downloadURL } = binInfo

  const resDir = path.join(cwd, 'extra', 'files')
  const targetPath = path.join(resDir, file)

  fs.mkdirSync(resDir, { recursive: true })
  await downloadFile(downloadURL, targetPath, { atomic: true })

  console.log(`[INFO]: ${file} finished`)
}

/**
 * download file and save to `path`
 */
async function downloadFile(url, filePath, options = {}) {
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() }
  })
  const targetPath = options.atomic ? `${filePath}.download` : filePath
  fs.rmSync(targetPath, { force: true })

  if (!response.body) throw new Error(`download failed with empty body: ${url}`)
  await pipeline(response.body, fs.createWriteStream(targetPath))
  if (options.atomic) replaceFile(targetPath, filePath)

  console.log(`[INFO]: download finished "${url}"`)
}

const resolveMmdb = () =>
  resolveResource({
    file: 'country.mmdb',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country-lite.mmdb`
  })
const resolveMetadb = () =>
  resolveResource({
    file: 'geoip.metadb',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.metadb`
  })
const resolveGeosite = () =>
  resolveResource({
    file: 'geosite.dat',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat`
  })
const resolveGeoIP = () =>
  resolveResource({
    file: 'geoip.dat',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat`
  })
const resolveASN = () =>
  resolveResource({
    file: 'ASN.mmdb',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb`
  })
const resolveEnableLoopback = () =>
  resolveResource({
    file: 'enableLoopback.exe',
    downloadURL: `https://github.com/Kuingsmile/uwp-tool/releases/download/latest/enableLoopback.exe`
  })
/* ======= sysproxy-rs ======= */
const SYSPROXY_RS_VERSION = 'v0.1.0'
const SYSPROXY_RS_URL_PREFIX = env(
  'SYSPROXY_RS_URL_PREFIX',
  `https://github.com/mihomo-party-org/sysproxy-rs-opti/releases/download/${env('SYSPROXY_RS_VERSION', SYSPROXY_RS_VERSION)}`
)

function getSysproxyNodeName() {
  // 检测是否为 musl 系统（与 src/native/sysproxy/index.js 保持一致）
  const isMusl = (() => {
    if (platform !== 'linux') return false
    try {
      const output = execSync('ldd --version 2>&1 || true').toString()
      return output.includes('musl')
    } catch {
      return false
    }
  })()

  const isWin7Build = process.env.LEGACY_BUILD === 'true'

  switch (platform) {
    case 'win32':
      if (arch === 'x64')
        return isWin7Build ? 'sysproxy.win32-x64-msvc-win7.node' : 'sysproxy.win32-x64-msvc.node'
      if (arch === 'arm64') return 'sysproxy.win32-arm64-msvc.node'
      if (arch === 'ia32')
        return isWin7Build ? 'sysproxy.win32-ia32-msvc-win7.node' : 'sysproxy.win32-ia32-msvc.node'
      break
    case 'darwin':
      if (arch === 'x64') return 'sysproxy.darwin-x64.node'
      if (arch === 'arm64') return 'sysproxy.darwin-arm64.node'
      break
    case 'linux':
      if (isMusl) {
        if (arch === 'x64') return 'sysproxy.linux-x64-musl.node'
        if (arch === 'arm64') return 'sysproxy.linux-arm64-musl.node'
      } else {
        if (arch === 'x64') return 'sysproxy.linux-x64-gnu.node'
        if (arch === 'arm64') return 'sysproxy.linux-arm64-gnu.node'
      }
      break
  }
  throw new Error(`Unsupported platform for sysproxy-rs: ${platform}-${arch}`)
}

const resolveSysproxy = async () => {
  const nodeName = getSysproxyNodeName()
  const sidecarDir = path.join(cwd, 'extra', 'sidecar')
  const targetPath = path.join(sidecarDir, nodeName)

  fs.mkdirSync(sidecarDir, { recursive: true })

  // 清理其他平台的 .node 文件
  const files = fs.readdirSync(sidecarDir)
  for (const file of files) {
    if (file.endsWith('.node') && file !== nodeName) {
      fs.rmSync(path.join(sidecarDir, file))
      console.log(`[INFO]: removed ${file}`)
    }
  }

  await downloadFile(`${SYSPROXY_RS_URL_PREFIX}/${nodeName}`, targetPath, { atomic: true })
  console.log(`[INFO]: ${nodeName} finished`)
}

const resolveMonitor = async () => {
  const tempDir = path.join(TEMP_DIR, 'TrafficMonitor')
  const tempZip = path.join(tempDir, `${arch}.zip`)
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }
  const resDir = path.join(cwd, 'extra', 'files')
  const targetPath = path.join(resDir, 'TrafficMonitor')
  const nextTargetPath = `${targetPath}.download`
  try {
    await downloadFile(
      `${env('TRAFFIC_MONITOR_URL_PREFIX', 'https://github.com/mihomo-party-org/mihomo-party-run/releases/download/monitor')}/${arch}.zip`,
      tempZip,
      { atomic: true }
    )
    const zip = new AdmZip(tempZip)
    fs.mkdirSync(resDir, { recursive: true })
    fs.rmSync(nextTargetPath, { recursive: true, force: true })
    zip.extractAllTo(nextTargetPath, true)
    replaceDir(nextTargetPath, targetPath)
    console.log(`[INFO]: TrafficMonitor finished`)
  } catch (error) {
    fs.rmSync(nextTargetPath, { recursive: true, force: true })
    throw error
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

const resolve7zip = () =>
  resolveResource({
    file: '7za.exe',
    downloadURL: `${env('SEVEN_ZIP_URL_PREFIX', 'https://github.com/develar/7zip-bin/raw/master/win')}/${arch}/7za.exe`
  })
const resolveSubstore = () =>
  resolveResource({
    file: 'sub-store.bundle.cjs',
    downloadURL: env(
      'SUBSTORE_BUNDLE_URL',
      'https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js'
    )
  })
const resolveHelper = () =>
  resolveResource({
    file: 'party.mihomo.helper',
    downloadURL: `${env('MIHOMO_HELPER_URL_PREFIX', 'https://github.com/mihomo-party-org/mihomo-party-helper/releases/download')}/${arch}/party.mihomo.helper`
  })
const resolveSubstoreFrontend = async () => {
  const tempDir = path.join(TEMP_DIR, 'substore-frontend')
  const tempZip = path.join(tempDir, 'dist.zip')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }
  const resDir = path.join(cwd, 'extra', 'files')
  const targetPath = path.join(resDir, 'sub-store-frontend')
  const nextTargetPath = `${targetPath}.download`
  try {
    await downloadFile(
      env(
        'SUBSTORE_FRONTEND_URL',
        'https://github.com/sub-store-org/Sub-Store-Front-End/releases/latest/download/dist.zip'
      ),
      tempZip,
      { atomic: true }
    )
    const zip = new AdmZip(tempZip)
    fs.mkdirSync(resDir, { recursive: true })
    fs.rmSync(nextTargetPath, { recursive: true, force: true })
    zip.extractAllTo(resDir, true)
    fs.renameSync(path.join(resDir, 'dist'), nextTargetPath)
    replaceDir(nextTargetPath, targetPath)
    console.log(`[INFO]: sub-store-frontend finished`)
  } catch (error) {
    fs.rmSync(nextTargetPath, { recursive: true, force: true })
    throw error
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}
const resolveFont = async () => {
  const targetPath = path.join(cwd, 'src', 'renderer', 'src', 'assets', 'NotoColorEmoji.ttf')

  if (fs.existsSync(targetPath)) {
    return
  }
  await downloadFile(
    env(
      'NOTO_COLOR_EMOJI_URL',
      'https://github.com/googlefonts/noto-emoji/raw/main/fonts/NotoColorEmoji.ttf'
    ),
    targetPath,
    { atomic: true }
  )

  console.log(`[INFO]: NotoColorEmoji.ttf finished`)
}

const tasks = [
  {
    name: 'mihomo-alpha',
    func: () =>
      resolveCoreVersion(CORE_CHANNELS.alpha).then(() =>
        resolveSidecar(coreSidecar(CORE_CHANNELS.alpha))
      ),
    retry: 5
  },
  {
    name: 'mihomo',
    func: () =>
      resolveCoreVersion(CORE_CHANNELS.mihomo).then(() =>
        resolveSidecar(coreSidecar(CORE_CHANNELS.mihomo))
      ),
    retry: 5
  },
  {
    name: 'mihomo-smart',
    func: () =>
      resolveCoreVersion(CORE_CHANNELS.smart).then(() =>
        resolveSidecar(coreSidecar(CORE_CHANNELS.smart))
      ),
    retry: 5
  },
  { name: 'mmdb', func: resolveMmdb, retry: 5 },
  { name: 'metadb', func: resolveMetadb, retry: 5 },
  { name: 'geosite', func: resolveGeosite, retry: 5 },
  { name: 'geoip', func: resolveGeoIP, retry: 5 },
  { name: 'asn', func: resolveASN, retry: 5 },
  {
    name: 'font',
    func: resolveFont,
    retry: 5
  },
  {
    name: 'enableLoopback',
    func: resolveEnableLoopback,
    retry: 5,
    winOnly: true
  },
  {
    name: 'sysproxy',
    func: resolveSysproxy,
    retry: 5
  },
  {
    name: 'monitor',
    func: resolveMonitor,
    retry: 5,
    winOnly: true
  },
  {
    name: 'substore',
    func: resolveSubstore,
    retry: 5
  },
  {
    name: 'substorefrontend',
    func: resolveSubstoreFrontend,
    retry: 5
  },
  {
    name: '7zip',
    func: resolve7zip,
    retry: 5,
    winOnly: true
  },
  {
    name: 'helper',
    func: resolveHelper,
    retry: 5,
    darwinOnly: true
  }
]

const requestedTasks = envList('PREPARE_TASKS', '')
if (requestedTasks.length > 0) {
  const requestedTaskSet = new Set(requestedTasks)
  const unknownTasks = requestedTasks.filter((name) => !tasks.some((task) => task.name === name))
  if (unknownTasks.length > 0) {
    throw new Error(`unknown PREPARE_TASKS: ${unknownTasks.join(', ')}`)
  }
  tasks.splice(0, tasks.length, ...tasks.filter((task) => requestedTaskSet.has(task.name)))
}

function shouldSkipTask(task) {
  if (task.winOnly && platform !== 'win32') return true
  if (task.linuxOnly && platform !== 'linux') return true
  if (task.unixOnly && platform === 'win32') return true
  if (task.darwinOnly && platform !== 'darwin') return true
  return false
}

async function runTask(task) {
  if (shouldSkipTask(task)) {
    console.log(`[INFO]: task::${task.name} skipped for ${platform}-${arch}`)
    return
  }

  for (let i = 0; i < task.retry; i++) {
    try {
      console.log(`[INFO]: task::${task.name} started (${i + 1}/${task.retry})`)
      await task.func()
      console.log(`[INFO]: task::${task.name} finished`)
      return
    } catch (err) {
      console.error(`[ERROR]: task::${task.name} try ${i + 1} ==`, err.message)
      if (i === task.retry - 1) {
        if (task.optional) {
          console.log(`[WARN]: Optional task::${task.name} failed, skipping...`)
          return
        } else {
          throw err
        }
      }
      await sleep(Math.min(1000 * 2 ** i, 10000))
    }
  }
}

async function runTasks() {
  const concurrency = envNumber('PREPARE_CONCURRENCY', 2)
  const queue = [...tasks]
  const failedTasks = []

  async function worker() {
    while (queue.length > 0) {
      const task = queue.shift()
      try {
        await runTask(task)
      } catch (error) {
        failedTasks.push({ task, error })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, () => worker())
  )

  if (failedTasks.length > 0) {
    for (const { task, error } of failedTasks) {
      console.error(`[ERROR]: task::${task.name} failed permanently:`, error.message)
    }
    throw new Error(`${failedTasks.length} prepare task(s) failed`)
  }
}

await runTasks()
