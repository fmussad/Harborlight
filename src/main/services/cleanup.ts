import type { CleanupCategory, CleanupPlan, CleanupResult } from '@shared/schemas/domain'
import type { ContainerEngine } from '../docker/engine'
import { formatBytes } from '@shared/utils/format'
import { logger } from './logger'

/**
 * Cleanup is always a two-step flow: analyse first, then remove exactly the
 * categories the user ticked.
 *
 * Volumes are deliberately a separate, unchecked category — they hold data that
 * cannot be rebuilt — and Harborlight never runs
 * `docker system prune -a --volumes`.
 */
export async function analyzeCleanup(engine: ContainerEngine): Promise<CleanupPlan> {
  const [containers, images, networks, volumes, disk] = await Promise.all([
    engine.listContainers(true),
    engine.listImages(),
    engine.listNetworks(),
    engine.listVolumes(),
    engine.diskUsage().catch(() => null)
  ])

  const stopped = containers.filter(
    (container) => container.state !== 'running' && container.state !== 'paused'
  )
  const dangling = images.filter((image) => image.dangling)
  const unusedImages = images.filter((image) => image.unused && !image.dangling)
  const unusedNetworks = networks.filter((network) => !network.system && !network.inUse)
  const unusedVolumes = volumes.filter((volume) => !volume.inUse)

  const danglingSize = dangling.reduce((sum, image) => sum + image.size, 0)
  const unusedImagesSize = unusedImages.reduce((sum, image) => sum + image.size, 0)
  const unusedVolumesSize = unusedVolumes.reduce((sum, volume) => sum + (volume.size ?? 0), 0)
  const stoppedSize = disk?.containers.reclaimable ?? 0
  const buildCacheSize = disk?.buildCache.reclaimable ?? 0

  const categories: CleanupPlan['categories'] = [
    {
      category: 'unusedImages',
      title: 'Unused images',
      description: 'Tagged images that no container references.',
      dangerous: false,
      defaultSelected: true,
      reclaimable: unusedImagesSize,
      items: unusedImages.map((image) => ({
        id: image.id,
        label: image.reference,
        detail: `${image.shortId} · ${formatBytes(image.size)}`,
        size: image.size
      }))
    },
    {
      category: 'danglingImages',
      title: 'Dangling images',
      description: 'Untagged layers left behind by rebuilds.',
      dangerous: false,
      defaultSelected: true,
      reclaimable: danglingSize,
      items: dangling.map((image) => ({
        id: image.id,
        label: `<none>:<none>`,
        detail: `${image.shortId} · ${formatBytes(image.size)}`,
        size: image.size
      }))
    },
    {
      category: 'stoppedContainers',
      title: 'Stopped containers',
      description: 'Containers that are not running or paused.',
      dangerous: false,
      defaultSelected: true,
      reclaimable: stoppedSize,
      items: stopped.map((container) => ({
        id: container.id,
        label: container.name,
        detail: `${container.image} · ${container.status}`,
        size: 0
      }))
    },
    {
      category: 'buildCache',
      title: 'Unused build cache',
      description: 'BuildKit cache entries no build is using.',
      dangerous: false,
      defaultSelected: true,
      reclaimable: buildCacheSize,
      items:
        buildCacheSize > 0
          ? [
              {
                id: 'build-cache',
                label: 'BuildKit cache',
                detail: `${disk?.buildCache.count ?? 0} records · ${formatBytes(buildCacheSize)}`,
                size: buildCacheSize
              }
            ]
          : []
    },
    {
      category: 'unusedNetworks',
      title: 'Unused networks',
      description: 'User-defined networks with no attached containers.',
      dangerous: false,
      defaultSelected: false,
      reclaimable: 0,
      items: unusedNetworks.map((network) => ({
        id: network.id,
        label: network.name,
        detail: `${network.driver} · ${network.subnets[0]?.subnet ?? 'no subnet'}`,
        size: 0
      }))
    },
    {
      category: 'unusedVolumes',
      title: 'Unused volumes',
      description: 'Volume data is deleted permanently and cannot be recovered.',
      dangerous: true,
      defaultSelected: false,
      reclaimable: unusedVolumesSize,
      items: unusedVolumes.map((volume) => ({
        id: volume.name,
        label: volume.name,
        detail: `${volume.driver} · ${volume.size === null ? 'size unknown' : formatBytes(volume.size)}`,
        size: volume.size ?? 0
      }))
    }
  ]

  // The headline figure excludes volumes: they are opt-in and must never be
  // implied by the primary button.
  const totalReclaimable = categories
    .filter((entry) => !entry.dangerous)
    .reduce((sum, entry) => sum + entry.reclaimable, 0)

  return { generatedAt: new Date().toISOString(), categories, totalReclaimable }
}

export async function runCleanup(
  engine: ContainerEngine,
  categories: CleanupCategory[],
  dryRun: boolean
): Promise<CleanupResult> {
  const startedAt = new Date().toISOString()
  const plan = await analyzeCleanup(engine)
  const entries: CleanupResult['entries'] = []
  let reclaimed = 0

  // Deterministic order: containers first so their images become removable.
  const order: CleanupCategory[] = [
    'stoppedContainers',
    'danglingImages',
    'unusedImages',
    'unusedNetworks',
    'buildCache',
    'unusedVolumes'
  ]

  for (const category of order) {
    if (!categories.includes(category)) continue
    const planned = plan.categories.find((entry) => entry.category === category)

    if (!planned || planned.items.length === 0) {
      entries.push({
        category,
        status: 'skipped',
        message: 'Nothing to remove in this category.',
        reclaimed: 0,
        removed: []
      })
      continue
    }

    if (dryRun) {
      entries.push({
        category,
        status: 'skipped',
        message: `Dry run: would remove ${planned.items.length} item(s), reclaiming ${formatBytes(planned.reclaimable)}.`,
        reclaimed: 0,
        removed: planned.items.map((item) => item.label)
      })
      continue
    }

    try {
      const outcome = await engine.prune(category)
      reclaimed += outcome.reclaimed
      entries.push({
        category,
        status: 'succeeded',
        message: `Removed ${outcome.removed.length} item(s), reclaimed ${formatBytes(outcome.reclaimed)}.`,
        reclaimed: outcome.reclaimed,
        removed: outcome.removed.filter(Boolean).slice(0, 200)
      })
    } catch (error) {
      logger.error('cleanup', `Pruning ${category} failed`, error)
      entries.push({
        category,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        reclaimed: 0,
        removed: []
      })
    }
  }

  return { dryRun, startedAt, finishedAt: new Date().toISOString(), reclaimed, entries }
}
