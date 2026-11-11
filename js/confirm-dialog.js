/**
 * Two-step confirmation for destructive actions.
 *
 * EN:
 *   Deleting a report cannot be undone, and the app is used in a hurry, with
 *   gloves, on a phone. A single "OK" is easy to hit by accident, so every
 *   deletion goes through TWO deliberate confirmations:
 *
 *     step 1 — "what is about to be deleted" → [Скасувати] [Видалити]
 *     step 2 — "this is final, are you sure" → [Так, видалити] [Скасувати]
 *
 *   Protection against an accidental double tap passing both steps:
 *     - the confirm button changes its POSITION between the steps, so a
 *       second tap on the same spot lands on «Скасувати»,
 *     - on step 2 the confirm button stays disabled for `ARM_DELAY_MS`.
 *
 *   Escape, the backdrop and «Скасувати» all resolve to `false`.
 *   One shared `<dialog>` is created lazily and reused.
 *
 * UA:
 *   Видалення звіту не скасувати, а застосунком користуються поспіхом, у
 *   рукавицях, з телефона. Одне «ОК» легко натиснути випадково, тому кожне
 *   видалення проходить ДВА свідомі підтвердження:
 *
 *     крок 1 — «що саме буде видалено»      → [Скасувати] [Видалити]
 *     крок 2 — «це остаточно, ви впевнені» → [Так, видалити] [Скасувати]
 *
 *   Захист від випадкового подвійного тапу, що проходить обидва кроки:
 *     - кнопка підтвердження між кроками змінює ПОЗИЦІЮ — другий тап у те
 *       саме місце потрапляє на «Скасувати»,
 *     - на кроці 2 кнопка підтвердження неактивна протягом `ARM_DELAY_MS`.
 *
 *   Escape, фон і «Скасувати» повертають `false`.
 *   Один спільний `<dialog>` створюється ліниво й перевикористовується.
 *
 * @module confirm-dialog
 */

/** EN: How long the final confirm button stays disabled (ms). UA: Скільки кнопка остаточного підтвердження неактивна (мс). */
const ARM_DELAY_MS = 700;

/** @type {HTMLDialogElement | null} */
let dialogEl = null;

/** EN: True while a confirmation is on screen. UA: true, поки підтвердження на екрані. */
let busy = false;

/**
 * EN: Builds the shared dialog once.
 * UA: Один раз будує спільний діалог.
 * @returns {HTMLDialogElement}
 */
function ensureDialog_() {
  if (dialogEl) return dialogEl;

  const d = document.createElement("dialog");
  d.className = "confirm-dialog";
  d.setAttribute("aria-labelledby", "confirmDialogTitle");
  d.innerHTML = `
    <div class="confirm-dialog-inner">
      <div class="confirm-dialog-step" data-role="step"></div>
      <div class="confirm-dialog-title" id="confirmDialogTitle" data-role="title"></div>
      <div class="confirm-dialog-message" data-role="message"></div>
      <div class="confirm-dialog-details" data-role="details"></div>
      <div class="confirm-dialog-actions" data-role="actions">
        <button type="button" class="btn" data-role="cancel">Скасувати</button>
        <button type="button" class="btn confirm-dialog-danger" data-role="confirm"></button>
      </div>
    </div>`;
  document.body.appendChild(d);
  dialogEl = d;
  return d;
}

/**
 * EN: Asks the user to confirm a deletion in two steps.
 * UA: Просить користувача підтвердити видалення у два кроки.
 *
 * @param {object} opt
 * @param {string} opt.title        EN: short heading, e.g. «Видалити звіт?». UA: короткий заголовок.
 * @param {string} [opt.message]    EN: what will be deleted. UA: що буде видалено.
 * @param {string} [opt.details]    EN: optional preview (report text); shown as pre-wrapped text. UA: необов'язковий перегляд (текст звіту).
 * @param {string} [opt.confirmLabel] EN: step-1 button label. UA: напис кнопки кроку 1.
 * @param {string} [opt.finalConfirmLabel] EN: step-2 button label. UA: напис кнопки кроку 2.
 * @param {string} [opt.finalMessage] EN: step-2 warning. UA: попередження кроку 2.
 * @returns {Promise<boolean>} EN: true only if both steps were confirmed. UA: true лише якщо підтверджено обидва кроки.
 */
export function confirmDeletion(opt) {
  const {
    title,
    message = "",
    details = "",
    confirmLabel = "Видалити",
    finalConfirmLabel = "Так, видалити",
    finalMessage = "Це остаточно. Відновити видалене буде неможливо.",
  } = opt || {};

  // EN: Old WebView without <dialog> — fall back to two native confirms.
  // UA: Старий WebView без <dialog> — два нативні confirm.
  if (typeof HTMLDialogElement === "undefined" || !HTMLDialogElement.prototype.showModal) {
    const first = window.confirm([title, message].filter(Boolean).join("\n\n"));
    if (!first) return Promise.resolve(false);
    return Promise.resolve(window.confirm(`Підтвердіть ще раз.\n\n${finalMessage}`));
  }

  if (busy) return Promise.resolve(false);
  busy = true;

  const d = ensureDialog_();
  const q = (role) => /** @type {HTMLElement} */ (d.querySelector(`[data-role="${role}"]`));
  const stepEl = q("step");
  const titleEl = q("title");
  const messageEl = q("message");
  const detailsEl = q("details");
  const actionsEl = q("actions");
  const cancelBtn = /** @type {HTMLButtonElement} */ (q("cancel"));
  const confirmBtn = /** @type {HTMLButtonElement} */ (q("confirm"));

  return new Promise((resolve) => {
    let step = 1;
    let armTimer = 0;

    const renderStep = () => {
      d.classList.toggle("confirm-dialog--final", step === 2);
      stepEl.textContent = `Крок ${step} із 2`;
      detailsEl.textContent = details;
      detailsEl.hidden = !details;

      if (step === 1) {
        titleEl.textContent = title;
        messageEl.textContent = message;
        messageEl.hidden = !message;
        confirmBtn.textContent = confirmLabel;
        confirmBtn.disabled = false;
        // [Скасувати] [Видалити]
        actionsEl.append(cancelBtn, confirmBtn);
        cancelBtn.focus();
      } else {
        titleEl.textContent = "Ви впевнені?";
        messageEl.textContent = finalMessage;
        messageEl.hidden = false;
        confirmBtn.textContent = finalConfirmLabel;
        // [Так, видалити] [Скасувати] — swapped on purpose.
        actionsEl.append(confirmBtn, cancelBtn);
        confirmBtn.disabled = true;
        armTimer = window.setTimeout(() => {
          confirmBtn.disabled = false;
        }, ARM_DELAY_MS);
        cancelBtn.focus();
      }
    };

    const finish = (result) => {
      window.clearTimeout(armTimer);
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      d.onclick = null;
      d.oncancel = null;
      d.onclose = null;
      if (d.open) d.close();
      busy = false;
      resolve(result);
    };

    confirmBtn.onclick = () => {
      if (confirmBtn.disabled) return;
      if (step === 1) {
        step = 2;
        renderStep();
        return;
      }
      finish(true);
    };
    cancelBtn.onclick = () => finish(false);

    // EN: Tap on the backdrop (the <dialog> itself, outside the inner box).
    // UA: Тап по фону (сам <dialog>, поза внутрішнім блоком).
    d.onclick = (ev) => {
      if (ev.target === d) finish(false);
    };
    // EN: Escape / Android "back". UA: Escape / «назад» на Android.
    d.oncancel = (ev) => {
      ev.preventDefault();
      finish(false);
    };
    d.onclose = () => finish(false);

    renderStep();
    d.showModal();
    cancelBtn.focus();
  });
}
