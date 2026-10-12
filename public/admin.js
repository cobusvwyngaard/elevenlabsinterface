// Administration for access codes. Deliberately plain: it exists to hand out codes and keys.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  async function call(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || "Request failed.");
    }
    return payload;
  }

  const adminHeaders = () => ({
    "Content-Type": "application/json",
    // Sent per request rather than exchanged for a session, so a page left open on a shared
    // machine is not itself an admin credential.
    "x-admin-code": $("adminCode").value,
  });

  function say(target, message, tone) {
    const node = $(target);
    node.textContent = message || "";
    node.className = `status-message${tone ? ` ${tone}` : ""}`;
  }

  /** Shows a new code once. It cannot be recovered later, so it is made hard to miss. */
  function showCode(label, identifier) {
    const box = $("newCode");
    box.className = "card";
    box.innerHTML = "";
    const heading = document.createElement("h3");
    heading.textContent = `Access code for ${label}`;
    const code = document.createElement("pre");
    code.className = "transcript-text";
    code.textContent = identifier;
    const note = document.createElement("p");
    note.className = "result-meta";
    note.textContent =
      "Copy this now and give it to them. Only a hash is stored, so it cannot be shown again — " +
      "but you can issue a replacement at any time.";
    box.append(heading, code, note);
  }

  async function refresh() {
    try {
      const { accounts } = await call("/api/admin/accounts", { headers: adminHeaders() });
      const list = $("accountList");
      list.innerHTML = "";
      if (!accounts.length) {
        list.innerHTML = '<p class="empty-note">No accounts yet.</p>';
        return;
      }
      for (const account of accounts) {
        const row = document.createElement("div");
        row.className = "card";
        const title = document.createElement("h3");
        title.textContent = account.label + (account.disabled ? " (disabled)" : "");
        const meta = document.createElement("p");
        meta.className = "result-meta";
        meta.textContent = `Created ${account.created_at}. Last signed in ${account.last_seen_at || "never"}.`;

        const rotate = document.createElement("button");
        rotate.className = "download-link";
        rotate.textContent = "Issue a new code";
        rotate.onclick = async () => {
          try {
            const result = await call(`/api/admin/accounts/${account.account_id}/rotate`, {
              method: "POST",
              headers: adminHeaders(),
            });
            showCode(account.label, result.identifier);
            say("adminStatus", "A new code was issued. The old one no longer works.");
          } catch (error) {
            say("adminStatus", error.message, "error");
          }
        };

        const toggle = document.createElement("button");
        toggle.className = "download-link";
        toggle.textContent = account.disabled ? "Enable" : "Disable";
        toggle.onclick = async () => {
          try {
            await call(`/api/admin/accounts/${account.account_id}/disabled`, {
              method: "POST",
              headers: adminHeaders(),
              body: JSON.stringify({ disabled: !account.disabled }),
            });
            await refresh();
          } catch (error) {
            say("adminStatus", error.message, "error");
          }
        };

        row.append(title, meta, rotate, toggle);
        list.appendChild(row);
      }
    } catch (error) {
      say("adminStatus", error.message, "error");
    }
  }

  window.addEventListener("DOMContentLoaded", async () => {
    const state = await call("/api/admin/state").catch(() => ({ claimed: true }));
    $(state.claimed ? "adminPanel" : "claimPanel").classList.remove("hidden");
    if (!state.claimed && state.needs_key_proof) {
      $("keyProofField").classList.remove("hidden");
      $("claimKeyTail").required = true;
    }

    $("claimForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await call("/api/admin/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            admin_code: $("claimCode").value,
            label: $("claimLabel").value,
            key_tail: $("claimKeyTail").value,
          }),
        });
        $("claimPanel").classList.add("hidden");
        $("adminPanel").classList.remove("hidden");
        if (result.first_account) {
          showCode(result.first_account.label, result.first_account.identifier);
          say(
            "adminStatus",
            `Claimed. The existing API key became this account, and ${result.first_account.adopted} ` +
              "earlier job(s) were assigned to it."
          );
        } else {
          say("adminStatus", "Claimed. No existing API key was found, so add accounts below.");
        }
      } catch (error) {
        say("claimStatus", error.message, "error");
      }
    });

    $("createForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await call("/api/admin/accounts", {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify({ label: $("newLabel").value, api_key: $("newKey").value }),
        });
        showCode(result.label, result.identifier);
        $("newLabel").value = "";
        $("newKey").value = "";
        say("adminStatus", "Account created.");
        await refresh();
      } catch (error) {
        say("adminStatus", error.message, "error");
      }
    });

    $("adminCode")?.addEventListener("change", refresh);
  });
})();
