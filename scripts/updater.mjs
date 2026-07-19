import { context, getOctokit } from '@actions/github'

const UPDATE_TAG_NAME = 'updater'
const UPDATE_JSON_FILE = 'update.json'
const UPDATE_JSON_PROXY = 'update-proxy.json'
const PROXY_PREFIX = 'https://update.hwdns.net/'

const SUPPORTED_PLATFORMS = new Set([
  'darwin-aarch64',
  'darwin-aarch64-app',
  'windows-x86_64',
  'windows-x86_64-nsis',
])

const REQUIRED_PLATFORMS = ['darwin-aarch64', 'windows-x86_64']

async function resolveUpdater() {
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error('GITHUB_TOKEN is required')
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo }
  const github = getOctokit(process.env.GITHUB_TOKEN)
  const release = await getLatestStableRelease(github, options)
  const sourceAsset = release.assets.find(
    (asset) => asset.name === 'latest.json',
  )

  if (!sourceAsset) {
    throw new Error(`Release ${release.tag_name} does not contain latest.json`)
  }

  const response = await fetch(sourceAsset.browser_download_url)
  if (!response.ok) {
    throw new Error(
      `Failed to download latest.json: ${response.status} ${response.statusText}`,
    )
  }

  const sourceManifest = await response.json()
  const version = release.tag_name.replace(/^v/, '')
  if (sourceManifest.version !== version) {
    throw new Error(
      `latest.json version ${sourceManifest.version} does not match ${version}`,
    )
  }

  const platforms = Object.fromEntries(
    Object.entries(sourceManifest.platforms ?? {}).filter(([platform]) =>
      SUPPORTED_PLATFORMS.has(platform),
    ),
  )

  validatePlatforms(platforms, options, release.tag_name)

  const updateData = {
    ...sourceManifest,
    version,
    pub_date: release.published_at ?? sourceManifest.pub_date,
    platforms,
  }
  const proxyData = withProxyUrls(updateData)
  const updateRelease = await getOrCreateUpdaterRelease(github, options)

  await replaceAssets(github, options, updateRelease, [
    [UPDATE_JSON_FILE, updateData],
    [UPDATE_JSON_PROXY, proxyData],
  ])

  console.log(
    `Published updater manifests for ${release.tag_name}: ${Object.keys(platforms).join(', ')}`,
  )
}

async function getLatestStableRelease(github, options) {
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...options,
    per_page: 100,
  })
  const stableReleases = releases
    .filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        /^v\d+\.\d+\.\d+$/.test(release.tag_name),
    )
    .sort((left, right) => compareVersions(right.tag_name, left.tag_name))

  if (stableReleases.length === 0) {
    throw new Error('No published stable release found')
  }

  return stableReleases[0]
}

function compareVersions(left, right) {
  const leftParts = left.slice(1).split('.').map(Number)
  const rightParts = right.slice(1).split('.').map(Number)

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index]
    if (difference !== 0) return difference
  }

  return 0
}

function validatePlatforms(platforms, options, tagName) {
  const expectedPrefix = `https://github.com/${options.owner}/${options.repo}/releases/download/${tagName}/`

  for (const platform of REQUIRED_PLATFORMS) {
    if (!platforms[platform]) {
      throw new Error(`latest.json is missing required platform ${platform}`)
    }
  }

  for (const [platform, artifact] of Object.entries(platforms)) {
    if (!artifact.url?.startsWith(expectedPrefix)) {
      throw new Error(`${platform} points outside the custom release`)
    }
    if (typeof artifact.signature !== 'string' || !artifact.signature.trim()) {
      throw new Error(`${platform} does not have a signature`)
    }
  }
}

function withProxyUrls(updateData) {
  const proxyData = structuredClone(updateData)

  for (const artifact of Object.values(proxyData.platforms)) {
    artifact.url = PROXY_PREFIX + artifact.url
  }

  return proxyData
}

async function getOrCreateUpdaterRelease(github, options) {
  try {
    const { data } = await github.rest.repos.getReleaseByTag({
      ...options,
      tag: UPDATE_TAG_NAME,
    })
    return data
  } catch (error) {
    if (error.status !== 404) throw error

    const { data } = await github.rest.repos.createRelease({
      ...options,
      tag_name: UPDATE_TAG_NAME,
      name: 'Auto-update Stable Channel',
      body: 'Updater manifests for the custom stable channel.',
      prerelease: false,
    })
    return data
  }
}

async function replaceAssets(github, options, release, assets) {
  const names = new Set(assets.map(([name]) => name))

  for (const asset of release.assets) {
    if (names.has(asset.name)) {
      await github.rest.repos.deleteReleaseAsset({
        ...options,
        asset_id: asset.id,
      })
    }
  }

  for (const [name, data] of assets) {
    await github.rest.repos.uploadReleaseAsset({
      ...options,
      release_id: release.id,
      name,
      data: JSON.stringify(data, null, 2),
      headers: { 'content-type': 'application/json' },
    })
  }
}

resolveUpdater().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
