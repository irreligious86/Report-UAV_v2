/**
 * EN: Orchestrator of the background sync loop. Holds the public API used by
 *     the rest of the app (`startSyncService`, `processSyncQueue`,
 *     `enqueueSendReport`, `processScheduledReports`) and delegates the heavy
 *     lifting to `sync-queue-processor.js`.
 *
 *     Responsibilities kept here:
 *       - single shared drain chain (no parallel POSTs),
 *       - 60-second tick timer,
 *       - crash recovery: move stuck SENDING reports back to QUEUED.
 *
 * UA: Оркестратор фонового циклу синхронізації. Тримає публічний API, яким
 *     користується решта додатку (`startSyncService`, `processSyncQueue`,
 *     `enqueueSendReport`, `processScheduledReports`), а "важку" логіку
 *     делегує у `sync-queue-processor.js`.
 *
 *     Залишається тут:
 *       - єдиний спільний drain-ланцюжок (без паралельних POST),
 *       - 60-секундний таймер,
 *       - відновлення після краху: застряглі SENDING → QUEUED.
 *
 * @module sync-service
 */

import { SYNC_STATUS, patchReportMeta } from "./report-model.js";
import * as reportsStore from "./reports-store.js";
import * as queueStore from "./sync-queue-store.js";
import { emitReportsChanged } from "./events.js";
import {
  processOneQueueItem,
  rotateSyncLog,
} from "./sync-queue-processor.js";

/** EN: Background tick timer id. / UA: ID таймера фонового циклу. @type {number|null} */
let tickTimer = null;

/**
 * EN: Sequential drain — all callers of `processSyncQueue` share this single
 *     promise chain, so only one POST runs at a time and send order is
 *     preserved across "fast Готово" taps.
 * UA: Послідовний drain — усі виклики `processSyncQueue` ланцюжаться через
 *     єдиний Promise, тому паралельних POST немає і порядок відправки
 *     зберігається навіть при швидких натисканнях «Готово».
 * @type {Promise<void>}
 */
let drainChain = Promise.resolve();

/** EN: Safety cap on iterations per drain. / UA: Страхувальна верхня межа ітерацій drain-у. */
const MAX_DRAIN_PER_RUN = 500;

/**
 * EN: Drains the send queue sequentially — one item per loop iteration.
 *     All callers share `drainChain`, so concurrent calls are linearised.
 *     Returns when the queue is empty or {@link MAX_DRAIN_PER_RUN} iterations
 *     have run.
 * UA: Послідовно "проганяє" чергу відправки — один елемент за ітерацію.
 *     Усі викликачі поділяють `drainChain`, паралельних викликів не буде.
 *     Завершується, коли черга порожня або досягнуто {@link MAX_DRAIN_PER_RUN}.
 * @returns {Promise<void>}
 */
export async function processSyncQueue() {
  drainChain = drainChain.then(drain_);
  return drainChain;
}

/**
 * EN: Internal drain loop — kept separate so it cannot be called directly.
 * UA: Внутрішній drain-цикл — окремо, щоб його не викликали напряму.
 * @returns {Promise<void>}
 */
async function drain_() {
  for (let i = 0; i < MAX_DRAIN_PER_RUN; i++) {
    const didWork = await processOneQueueItem();
    if (!didWork) break;
  }
}

/**
 * EN: Enqueues a report for sending: marks it QUEUED in IndexedDB and adds a
 *     queue item. Safe to call multiple times — duplicate queue items for the
 *     same reportId are deduplicated by the queue store.
 * UA: Ставить звіт у чергу: маркує QUEUED і додає queue item. Безпечно
 *     викликати багато разів — дублі для одного reportId зливаються у store.
 * @param {string} reportId
 * @returns {Promise<void>}
 */
export async function enqueueSendReport(reportId) {
  const r = await reportsStore.getReportById(reportId);
  if (!r) return;
  await reportsStore.putReport(
    patchReportMeta(r, { syncStatus: SYNC_STATUS.QUEUED }),
  );
  await queueStore.enqueueQueueItem({ reportId, action: "send" });
  emitReportsChanged();
}

/**
 * EN: Scans SCHEDULED reports and enqueues any whose `sendAfter` time has
 *     passed. Called on startup and periodically from the background tick.
 * UA: Сканує SCHEDULED-звіти і ставить у чергу ті, чий час `sendAfter` вже
 *     настав. Викликається на старті та періодично з фонового таймера.
 * @returns {Promise<void>}
 */
export async function processScheduledReports() {
  const scheduled = await reportsStore.getReportsBySyncStatus(
    SYNC_STATUS.SCHEDULED,
  );
  const now = Date.now();
  for (const r of scheduled) {
    if (!r.sendAfter) continue;
    const t = Date.parse(r.sendAfter);
    if (Number.isNaN(t) || t > now) continue;
    await enqueueSendReport(r.id);
  }
}

/**
 * EN: Startup recovery — any report stuck in SENDING means the app was killed
 *     mid-POST last session. Move them back to QUEUED so the next drain picks
 *     them up.
 * UA: Відновлення на старті — звіт у SENDING означає, що попередня сесія
 *     впала під час POST. Повертаємо у QUEUED, наступний drain їх підбере.
 * @returns {Promise<void>}
 */
async function recoverStuckSendingReports_() {
  const stuck = await reportsStore.getReportsBySyncStatus(SYNC_STATUS.SENDING);
  for (const r of stuck) {
    await reportsStore.putReport(
      patchReportMeta(r, { syncStatus: SYNC_STATUS.QUEUED }),
    );
    await queueStore.enqueueQueueItem({ reportId: r.id, action: "send" });
  }
  if (stuck.length) emitReportsChanged();
}

/**
 * EN: Starts the background sync loop. Runs crash recovery + log rotation,
 *     then ticks every 60 s to mature SCHEDULED reports and drain the queue.
 *     Safe to call multiple times — only one timer is ever scheduled.
 * UA: Запускає фоновий цикл синхронізації. Відновлення після краху + ротація
 *     лога, далі тік кожні 60 с: дозрівання SCHEDULED та drain черги.
 *     Безпечно викликати багато разів — таймер стартує лише один раз.
 * @returns {Promise<void>}
 */
export async function startSyncService() {
  if (tickTimer !== null) return;

  await recoverStuckSendingReports_();
  await rotateSyncLog();

  const tick = async () => {
    await processScheduledReports();
    await processSyncQueue();
  };

  void tick();
  tickTimer = window.setInterval(() => void tick(), 60_000);
}
