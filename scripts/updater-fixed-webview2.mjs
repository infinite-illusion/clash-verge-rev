import { context, getOctokit } from '@actions/github'
import fetch from 'node-fetch'

import { resolveUpdateLog, resolveUpdateLogDefault } from './updatelog.mjs'

const UPDATE_TAG_NAME = 'updater'
const UPDATE_JSON_FILE = 'update-fixed-webview2.json'
const UPDATE_JSON_PROXY = 'update-fixed-webview2-proxy.json'
const PROXY_PREFIX = 'https://update.hwdns.net/'

async function resolveUpdater() {
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error('GITHUB_TOKEN is required')
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo }
  const github = getOctokit(process.env.GITHUB_TOKEN)
  const release = await getLatestStableRelease(github, options)
  const version = release.tag_name.replace(/^v/, '')
  const platforms = {}

  for (const [platform, arch] of [['windows-x86_64', 'x64']]) {
    const urlAsset = findAsset(release, `${arch}_fixed_webview2-setup.exe`)
    const signatureAsset = findAsset(
      release,
      `${arch}_fixed_webview2-setup.exe.sig`,
    )
    const signature = await getSignature(signatureAsset.browser_download_url)
    const artifact = {
      url: urlAsset.browser_download_url,
      signature,
    }

    validateArtifact(artifact, options, release.tag_name, platform)
    platforms[platform] = artifact
    platforms[`${platform}-nsis`] = { ...artifact }
  }

  const updateData = {
    version,
    notes: await resolveUpdateLog(release.tag_name).catch(() =>
      resolveUpdateLogDefault().catch(() => 'No changelog available'),
    ),
    pub_date: release.published_at ?? new Date().toISOString(),
    platforms,
  }
  const proxyData = structuredClone(updateData)
  for (const artifact of Object.values(proxyData.platforms)) {
    artifact.url = PROXY_PREFIX + artifact.url
  }

  const { data: updateRelease } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag: UPDATE_TAG_NAME,
  })
  await replaceAssets(github, options, updateRelease, [
    [UPDATE_JSON_FILE, updateData],
    [UPDATE_JSON_PROXY, proxyData],
  ])

  console.log(
    `Published fixed-WebView2 updater manifests for ${release.tag_name}`,
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

function findAsset(release, suffix) {
  const asset = release.assets.find((candidate) =>
    candidate.name.endsWith(suffix),
  )
  if (!asset) {
    throw new Error(`Release ${release.tag_name} is missing ${suffix}`)
  }
  return asset
}

async function getSignature(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to download signature: ${response.status} ${response.statusText}`,
    )
  }

  const signature = (await response.text()).trim()
  if (!signature) {
    throw new Error(`Signature at ${url} is empty`)
  }
  return signature
}

function validateArtifact(artifact, options, tagName, platform) {
  const expectedPrefix = `https://github.com/${options.owner}/${options.repo}/releases/download/${tagName}/`
  if (!artifact.url.startsWith(expectedPrefix)) {
    throw new Error(`${platform} points outside the custom release`)
  }
  if (!artifact.signature) {
    throw new Error(`${platform} does not have a signature`)
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
