import fs from 'fs'
import AdmZip from 'adm-zip'
import path from 'path'
import zlib from 'zlib'
import { extract } from 'tar'
import { execSync } from 'child_process'

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

function authHeaders() {
  const token = process.env.CORE_DOWNLOAD_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchText(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: authHeaders()
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
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
  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json', ...authHeaders() }
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const release = await response.json()
  const asset = release.assets?.find((item) => {
    const name = item.name || ''
    return (
      name.startsWith(`${artifactBaseName}-`) && (name.endsWith('.zip') || name.endsWith('.gz'))
    )
  })
  if (!asset) throw new Error(`no release asset found for ${artifactBaseName}`)
  return asset.name
    .replace(`${artifactBaseName}-`, '')
    .replace(/\.zip$/, '')
    .replace(/\.gz$/, '')
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

function downloadReleasePrefix(channel) {
  const exactPrefix = process.env[`${channel.envPrefix}_RELEASE_URL_PREFIX`]
  if (exactPrefix) return exactPrefix

  const legacyPrefix = process.env[`${channel.envPrefix}_URL_PREFIX`]
  if (channel.envPrefix === 'MIHOMO' && legacyPrefix) {
    return `${legacyPrefix}/${channel.version}`
  }

  return channel.releasePrefix
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
      return env('MIHOMO_ALPHA_URL_PREFIX', OWN_CORE_RELEASE_PREFIX)
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
      return env('MIHOMO_SMART_URL_PREFIX', OWN_CORE_RELEASE_PREFIX)
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
    console.error(`Error fetching ${channel.label} version:`, error.message)
    process.exit(1)
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

  fs.mkdirSync(sidecarDir, { recursive: true })
  if (fs.existsSync(sidecarPath)) {
    fs.rmSync(sidecarPath)
  }
  const tempDir = path.join(TEMP_DIR, name)
  const tempZip = path.join(tempDir, zipFile)
  const tempExe = path.join(tempDir, exeFile)

  fs.mkdirSync(tempDir, { recursive: true })
  try {
    if (!fs.existsSync(tempZip)) {
      await downloadFile(downloadURL, tempZip)
    }

    if (zipFile.endsWith('.zip')) {
      const zip = new AdmZip(tempZip)
      zip.getEntries().forEach((entry) => {
        console.log(`[DEBUG]: "${name}" entry name`, entry.entryName)
      })
      zip.extractAllTo(tempDir, true)
      fs.renameSync(tempExe, sidecarPath)
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
      const extractedFile = files.find((file) => file.startsWith('虚空终端-'))
      if (extractedFile) {
        const extractedFilePath = path.join(tempDir, extractedFile)
        fs.renameSync(extractedFilePath, sidecarPath)
        console.log(`[INFO]: "${name}" file renamed to "${sidecarPath}"`)
        execSync(`chmod 755 ${sidecarPath}`)
        console.log(`[INFO]: "${name}" chmod binary finished`)
      } else {
        throw new Error(`Expected file not found in ${tempDir}`)
      }
    } else {
      // gz
      const readStream = fs.createReadStream(tempZip)
      const writeStream = fs.createWriteStream(sidecarPath)
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          console.error(`[ERROR]: "${name}" gz failed:`, error.message)
          reject(error)
        }
        readStream
          .pipe(zlib.createGunzip().on('error', onError))
          .pipe(writeStream)
          .on('finish', () => {
            console.log(`[INFO]: "${name}" gunzip finished`)
            execSync(`chmod 755 ${sidecarPath}`)
            console.log(`[INFO]: "${name}" chmod binary finished`)
            resolve()
          })
          .on('error', onError)
      })
    }
  } catch (err) {
    // 需要删除文件
    fs.rmSync(sidecarPath, { force: true })
    throw err
  } finally {
    fs.rmSync(tempDir, { recursive: true })
  }
}

/**
 * download the file to the extra dir
 */
async function resolveResource(binInfo) {
  const { file, downloadURL } = binInfo

  const resDir = path.join(cwd, 'extra', 'files')
  const targetPath = path.join(resDir, file)

  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath)
  }

  fs.mkdirSync(resDir, { recursive: true })
  await downloadFile(downloadURL, targetPath)

  console.log(`[INFO]: ${file} finished`)
}

/**
 * download file and save to `path`
 */
async function downloadFile(url, path) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() }
  })
  if (!response.ok) {
    throw new Error(`download failed ${response.status} ${response.statusText}: ${url}`)
  }
  const buffer = await response.arrayBuffer()
  fs.writeFileSync(path, new Uint8Array(buffer))

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

  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath)
  }

  await downloadFile(`${SYSPROXY_RS_URL_PREFIX}/${nodeName}`, targetPath)
  console.log(`[INFO]: ${nodeName} finished`)
}

const resolveMonitor = async () => {
  const tempDir = path.join(TEMP_DIR, 'TrafficMonitor')
  const tempZip = path.join(tempDir, `${arch}.zip`)
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }
  await downloadFile(
    `${env('TRAFFIC_MONITOR_URL_PREFIX', 'https://github.com/mihomo-party-org/mihomo-party-run/releases/download/monitor')}/${arch}.zip`,
    tempZip
  )
  const zip = new AdmZip(tempZip)
  const resDir = path.join(cwd, 'extra', 'files')
  const targetPath = path.join(resDir, 'TrafficMonitor')
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true })
  }
  zip.extractAllTo(targetPath, true)

  console.log(`[INFO]: TrafficMonitor finished`)
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
  await downloadFile(
    env(
      'SUBSTORE_FRONTEND_URL',
      'https://github.com/sub-store-org/Sub-Store-Front-End/releases/latest/download/dist.zip'
    ),
    tempZip
  )
  const zip = new AdmZip(tempZip)
  const resDir = path.join(cwd, 'extra', 'files')
  const targetPath = path.join(resDir, 'sub-store-frontend')
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true })
  }
  zip.extractAllTo(resDir, true)
  fs.renameSync(path.join(resDir, 'dist'), targetPath)

  console.log(`[INFO]: sub-store-frontend finished`)
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
    targetPath
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
  tasks.splice(0, tasks.length, ...tasks.filter((task) => requestedTasks.includes(task.name)))
}

async function runTask() {
  const task = tasks.shift()
  if (!task) return
  if (task.winOnly && platform !== 'win32') return runTask()
  if (task.linuxOnly && platform !== 'linux') return runTask()
  if (task.unixOnly && platform === 'win32') return runTask()
  if (task.darwinOnly && platform !== 'darwin') return runTask()

  for (let i = 0; i < task.retry; i++) {
    try {
      await task.func()
      break
    } catch (err) {
      console.error(`[ERROR]: task::${task.name} try ${i} ==`, err.message)
      if (i === task.retry - 1) {
        if (task.optional) {
          console.log(`[WARN]: Optional task::${task.name} failed, skipping...`)
          break
        } else {
          throw err
        }
      }
    }
  }
  return runTask()
}

runTask()
runTask()
