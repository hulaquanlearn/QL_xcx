// Keeps successful photos intact: a retry only resumes the failed stage.
function createUploadQueue(options) {
  const items = [];
  const concurrency = Math.max(1, Math.min(3, Number(options.concurrency) || 2));
  let nextId = 1;
  let paused = false;
  let running = 0;
  let settled = [];
  const cancelled = () => paused || Boolean(options.isCancelled && options.isCancelled());
  const emit = () => options.onChange && options.onChange(items.map(item => ({ ...item })), running > 0);
  const wait = () => new Promise(resolve => settled.push(resolve));

  async function process(item) {
    item.error = '';
    try {
      const controls = {
        isCancelled: cancelled,
        onStatus: event => {
          const change = typeof event === 'string' ? { status: event } : event;
          if (change.checkId) item.checkId = change.checkId;
          if (!cancelled()) {
            item.status = change.status;
            emit();
          }
        }
      };
      if (!item.key) {
        item.status = item.checkId ? 'moderating' : 'uploading';
        emit();
        const result = item.checkId
          ? await options.waitForReview(item.checkId, controls)
          : await options.upload(item.path, controls);
        item.key = result.key;
        if (!item.key) throw new Error('服务器未返回可用图片');
      }
      if (cancelled()) {
        item.status = 'paused';
        return;
      }
      item.status = 'saving';
      emit();
      await options.save(item.key, item);
      item.status = 'ready';
      if (options.onSaved) options.onSaved(item);
    } catch (error) {
      if (error.checkId) item.checkId = error.checkId;
      item.status = cancelled() || error.cancelled ? 'paused' : 'failed';
      item.error = error.message || '上传失败，请重试';
      item.rejected = Boolean(error.rejected);
    }
  }

  function pump() {
    while (!cancelled() && running < concurrency) {
      const item = items.find(photo => photo.status === 'queued');
      if (!item) break;
      running += 1;
      item.status = 'uploading';
      process(item).finally(() => {
        running -= 1;
        pump();
      });
    }
    emit();
    if (!running && (cancelled() || !items.some(item => item.status === 'queued'))) {
      settled.splice(0).forEach(resolve => resolve(items));
    }
  }

  return {
    add(paths, context = null) {
      (paths || []).forEach(path => items.push({ id: String(nextId++), path, context, status: 'queued', error: '' }));
      paused = false;
      const done = wait();
      pump();
      return done;
    },
    retry(id) {
      const item = items.find(photo => photo.id === String(id));
      if (!item || !['failed', 'paused'].includes(item.status) || item.rejected) return Promise.resolve();
      item.status = 'queued';
      paused = false;
      const done = wait();
      pump();
      return done;
    },
    pause() {
      paused = true;
      items.forEach(item => { if (item.status === 'queued') item.status = 'paused'; });
      pump();
    },
    resume() {
      paused = false;
      items.forEach(item => { if (item.status === 'paused') item.status = 'queued'; });
      const done = wait();
      pump();
      return done;
    },
    clearFinished() {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index].status === 'ready' || items[index].rejected) items.splice(index, 1);
      }
      emit();
    }
  };
}

module.exports = { createUploadQueue };
