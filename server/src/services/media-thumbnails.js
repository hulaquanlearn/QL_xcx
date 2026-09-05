const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const config = require('../config');

const FILENAME_RE = /^[a-f0-9]{32}\.(?:jpg|png|webp)$/;
const MAX_INPUT_PIXELS = 24 * 1000 * 1000;
const MAX_CONCURRENT = 2;
const MAX_QUEUED = 8;

// Only called after the HTTP route authenticates the couple and finds the
// approved original. Nothing under this directory is mounted as public static.
function createThumbnailService({ mediaDir = () => config.mediaDir, sharpFactory = sharp,
  maxConcurrent = MAX_CONCURRENT, maxQueued = MAX_QUEUED } = {}) {
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENT, Number(maxConcurrent) || MAX_CONCURRENT));
  const queueLimit = Math.max(0, Math.min(MAX_QUEUED, Number(maxQueued) || 0));
  const jobs = new Map();
  const waiting = [];
  let active = 0;

  function pathsFor(coupleId, filename) {
    if (!/^\d+$/.test(String(coupleId)) || !FILENAME_RE.test(String(filename))) return null;
    const root = path.resolve(typeof mediaDir === 'function' ? mediaDir() : mediaDir);
    return {
      source: path.join(root, String(coupleId), filename),
      directory: path.join(root, '.thumbnails', String(coupleId)),
      filename
    };
  }

  async function sourceStamp(source) {
    const stat = await fs.lstat(source);
    // The uploader produces regular files, never symlinks or directories.
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Original is not a regular file');
    return crypto.createHash('sha256').update(`${source}:${stat.mtimeMs}:${stat.size}`).digest('hex').slice(0, 20);
  }

  function pump() {
    while (active < concurrency && waiting.length) {
      const job = waiting.shift();
      active += 1;
      render(job).then(job.resolve, () => job.resolve(null)).finally(() => {
        active -= 1;
        jobs.delete(job.target);
        pump();
      });
    }
  }

  async function render(job) {
    const temporary = `${job.target}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      if (job.cancelled || await sourceStamp(job.source) !== job.stamp) return null;
      await fs.mkdir(job.directory, { recursive: true, mode: 0o700 });
      await sharpFactory(job.source, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning', sequentialRead: true })
        .rotate()
        .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(temporary);
      // Deletion or replacement during decoding must not resurrect a derivative.
      if (job.cancelled || await sourceStamp(job.source) !== job.stamp) return null;
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, job.target);
      return job.target;
    } catch {
      // Corrupt/oversized images, a full disk, or a busy queue must not prevent
      // an authorized user from viewing the original image.
      return null;
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async function resolve(coupleId, filename) {
    const files = pathsFor(coupleId, filename);
    if (!files) return null;
    try {
      // Check the source before every cache hit; deleted originals stay deleted.
      const stamp = await sourceStamp(files.source);
      const target = path.join(files.directory, `${filename}.${stamp}.jpg`);
      const cached = await fs.lstat(target).catch(() => null);
      if (cached?.isFile() && !cached.isSymbolicLink()) return target;
      if (jobs.has(target)) return jobs.get(target).promise;
      if (active >= concurrency && waiting.length >= queueLimit) return null;
      const job = { ...files, target, stamp, cancelled: false };
      job.promise = new Promise(resolveJob => { job.resolve = resolveJob; });
      jobs.set(target, job);
      waiting.push(job);
      pump();
      return job.promise;
    } catch {
      return null;
    }
  }

  async function remove(coupleId, filename) {
    const files = pathsFor(coupleId, filename);
    if (!files) return;
    const ongoing = [...jobs.values()].filter(job => job.source === files.source);
    ongoing.forEach(job => { job.cancelled = true; });
    await Promise.all(ongoing.map(job => job.promise));
    const names = await fs.readdir(files.directory).catch(() => []);
    await Promise.all(names.filter(name => name.startsWith(`${filename}.`) && /\.(?:jpg|tmp)$/.test(name))
      .map(name => fs.unlink(path.join(files.directory, name)).catch(() => {})));
  }

  return { resolve, remove };
}

const thumbnails = createThumbnailService();
module.exports = {
  resolveThumbnail: thumbnails.resolve,
  removeThumbnails: thumbnails.remove,
  createThumbnailService,
  MAX_INPUT_PIXELS,
  MAX_CONCURRENT,
  MAX_QUEUED
};
