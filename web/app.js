const logEl = document.getElementById("log");
const careosPill = document.getElementById("careosPill");
const ocrPill = document.getElementById("ocrPill");
const clientsView = document.getElementById("clientsView");
const complianceView = document.getElementById("complianceView");

function log(title, data) {
  const block =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const stamp = new Date().toLocaleTimeString();
  logEl.textContent += `\n\n[${stamp}] ${title}\n${block}`;
  logEl.scrollTop = logEl.scrollHeight;
}

async function api(path, init) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data?.error ?? data?.detail ?? `HTTP ${res.status}`);
  }
  return data;
}

function setPill(el, ok, label) {
  el.textContent = label;
  el.classList.toggle("ok", ok);
  el.classList.toggle("bad", !ok);
}

function renderClients(items) {
  if (!items?.length) {
    clientsView.className = "table-wrap empty";
    clientsView.textContent = "No clients";
    return;
  }
  clientsView.className = "table-wrap";
  clientsView.innerHTML = `<table>
    <thead><tr><th>ID</th><th>Name</th><th>Address</th><th>Type</th></tr></thead>
    <tbody>
      ${items
        .map(
          (c) => `<tr>
        <td>${esc(c.cl_id)}</td>
        <td>${esc(c.full_nm)}</td>
        <td>${esc(`${c.addr_line1}, ${c.addr_suburb} ${c.addr_state} ${c.addr_postcode}`)}</td>
        <td>${esc(c.care_type)}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderCompliance(items) {
  if (!items?.length) {
    complianceView.className = "table-wrap empty";
    complianceView.textContent = "No open items";
    return;
  }
  complianceView.className = "table-wrap";
  complianceView.innerHTML = `<table>
    <thead><tr><th>Sev</th><th>Client</th><th>Title</th><th>Due</th></tr></thead>
    <tbody>
      ${items
        .map(
          (c) => `<tr>
        <td>${esc(c.severity)}</td>
        <td>${esc(c.cl_id)}</td>
        <td>${esc(c.title)}</td>
        <td>${esc(c.due_dt)}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function checkHealth() {
  const data = await api("/v1/demo/status");
  setPill(careosPill, !!data.careos?.ok, data.careos?.ok ? "CareOS OK" : "CareOS down");
  setPill(ocrPill, !!data.ocr?.ok, data.ocr?.ok ? "OCR OK" : "OCR down");
  log("Health", data);
  return data;
}

async function loadLists() {
  const [clients, compliance] = await Promise.all([
    api("/v1/clients"),
    api("/v1/compliance?open=1"),
  ]);
  renderClients(clients.items);
  renderCompliance(compliance.items);
  log("Clients", { count: clients.items.length });
  log("Open compliance", { count: compliance.items.length, items: compliance.items });
  return { clients, compliance };
}

async function runOcr() {
  const data = await api("/v1/demo/ocr", {
    method: "POST",
    body: JSON.stringify({ path: "samples/gp-letter-aisha.png" }),
  });
  log("OCR result", data);
  return data;
}

async function runAddressFlow() {
  const pending = await api("/v1/pending-changes", {
    method: "POST",
    body: JSON.stringify({
      tool: "update_client_address",
      payload: {
        cl_id: "CL-1003",
        addr_line1: "19 Herring Rd",
        addr_suburb: "Marsfield",
        addr_postcode: "2122",
        addr_state: "NSW",
        doc_id: "DOC-1",
      },
    }),
  });
  log("Pending change created", pending);

  const applied = await api(`/v1/pending-changes/${encodeURIComponent(pending.change_id)}/apply`, {
    method: "POST",
    body: "{}",
  });
  log("Pending change applied", applied);

  const client = await api("/v1/clients/CL-1003");
  log("Client CL-1003 after update", {
    full_nm: client.full_nm,
    address: `${client.addr_line1}, ${client.addr_suburb} ${client.addr_state} ${client.addr_postcode}`,
  });
  return { pending, applied, client };
}

async function runRoster() {
  const data = await api("/v1/demo/roster?zone=Eastwood");
  log("Roster overlaps (Eastwood)", data);
  return data;
}

async function runAll() {
  await checkHealth();
  await loadLists();
  await runOcr();
  await runAddressFlow();
  await runRoster();
  await loadLists();
  log("Walkthrough", "All customer test steps completed.");
}

const actions = {
  health: checkHealth,
  clients: loadLists,
  ocr: runOcr,
  address: runAddressFlow,
  roster: runRoster,
  all: runAll,
};

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const key = btn.getAttribute("data-action");
    const fn = actions[key];
    if (!fn) return;
    const buttons = [...document.querySelectorAll("[data-action]")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      await fn();
    } catch (err) {
      log("Error", err instanceof Error ? err.message : String(err));
      setPill(careosPill, false, "CareOS error");
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
});

document.getElementById("clearLog").addEventListener("click", () => {
  logEl.textContent = "Log cleared.";
});

checkHealth().catch((err) => {
  setPill(careosPill, false, "CareOS down");
  setPill(ocrPill, false, "OCR unknown");
  log("Startup health failed", err instanceof Error ? err.message : String(err));
});
