const form = document.getElementById("login");
const err = document.getElementById("err");
const btn = document.getElementById("go");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.textContent = "";
  btn.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.getElementById("pw").value }),
    });
    if (res.ok) { location.replace("/#/heute"); return; }
    const data = await res.json().catch(() => ({}));
    err.textContent = data.error || "Anmeldung fehlgeschlagen.";
  } catch {
    err.textContent = "Server nicht erreichbar. Im Heimnetz oder VPN?";
  }
  btn.disabled = false;
});
