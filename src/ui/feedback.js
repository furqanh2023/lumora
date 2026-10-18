/** Global, dependency-light feedback UI. Uses a body-level fixed layer so app
 * stacking contexts, route transitions, and component overflow cannot hide it. */
const toastTimers = new WeakMap();
export function notify(message, type = "info") {
  const text = String(message || "").trim();
  if (!text || typeof document === "undefined") return;
  let host = document.getElementById("lumora-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "lumora-toast-host";
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-relevant", "additions text");
    host.setAttribute("aria-atomic", "false");
    document.body.appendChild(host);
  }
  const toast = document.createElement("div");
  const kind = ["success", "error", "warning", "info"].includes(type) ? type : "info";
  toast.className = `lumora-toast-item is-${kind}`;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");
  const icon = document.createElement("span");
  icon.className = "lumora-toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = ({ success: "✓", error: "!", warning: "⚠", info: "i" })[kind];
  const content = document.createElement("span");
  content.className = "lumora-toast-message";
  content.textContent = text;
  const close = document.createElement("button");
  close.type = "button"; close.className = "lumora-toast-close"; close.setAttribute("aria-label", "Dismiss notification"); close.textContent = "×";
  const remove = () => { if (!toast.isConnected) return; toast.classList.add("is-leaving"); window.setTimeout(() => toast.remove(), 180); };
  close.addEventListener("click", remove);
  toast.append(icon, content, close);
  host.appendChild(toast);
  while (host.children.length > 5) host.firstElementChild?.remove();
  window.requestAnimationFrame(() => toast.classList.add("is-visible"));
  const duration = kind === "error" ? 6500 : kind === "warning" ? 5500 : 4000;
  const timer = window.setTimeout(remove, duration);
  toastTimers.set(toast, timer);
  return toast;
}

function openDialog({ title, message = "", value = "", placeholder = "", confirmText = "Continue", cancelText = "Cancel", danger = false, input = false, multiline = false, required = false }) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "lumora-feedback-dialog";
    try { dialog.dataset.theme = window.localStorage.getItem("lumora-theme") === "dark" ? "dark" : "light"; } catch { dialog.dataset.theme = "light"; }
    dialog.setAttribute("aria-labelledby", "lumora-feedback-title");
    const form = document.createElement("form");
    form.className = "lumora-feedback-dialog__form";
    form.method = "dialog";
    const heading = document.createElement("h2");
    heading.id = "lumora-feedback-title";
    heading.textContent = title || "Lumora";
    form.appendChild(heading);
    if (message) {
      const copy = document.createElement("p");
      copy.className = "lumora-feedback-dialog__message";
      copy.textContent = message;
      form.appendChild(copy);
    }
    let field = null;
    if (input) {
      field = multiline ? document.createElement("textarea") : document.createElement("input");
      field.className = "lumora-feedback-dialog__input";
      field.value = value == null ? "" : String(value);
      field.placeholder = placeholder;
      field.setAttribute("aria-label", title || "Input");
      if (field.tagName === "INPUT") field.type = "text";
      if (required) field.required = true;
      field.maxLength = 5000;
      form.appendChild(field);
    }
    const actions = document.createElement("div");
    actions.className = "lumora-feedback-dialog__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "lumora-feedback-dialog__cancel";
    cancel.textContent = cancelText;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = `lumora-feedback-dialog__confirm${danger ? " is-danger" : ""}`;
    submit.textContent = confirmText;
    actions.append(cancel, submit);
    form.appendChild(actions);
    dialog.appendChild(form);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
    dialog.addEventListener("click", (event) => { if (event.target === dialog) finish(null); });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (required && !field?.value.trim()) { field?.focus(); return; }
      finish(input ? field.value : true);
    });
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "open");
    if (field) { field.focus(); if (!multiline) field.select(); }
  });
}

export function confirmDialog(title, message, options = {}) {
  return openDialog({ title, message, confirmText: options.confirmText || "Confirm", cancelText: options.cancelText || "Cancel", danger: Boolean(options.danger) }).then(Boolean);
}

export function promptDialog(title, value = "", options = {}) {
  return openDialog({ title, message: options.message || "", value, placeholder: options.placeholder || "", confirmText: options.confirmText || "Save", cancelText: options.cancelText || "Cancel", input: true, multiline: Boolean(options.multiline), required: Boolean(options.required), danger: Boolean(options.danger) });
}

export async function copyText(text, fallbackTitle = "Copy this text") {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const result = await promptDialog(fallbackTitle, text, { message: "Copy the text below.", confirmText: "Done" });
    return result !== null;
  }
}
