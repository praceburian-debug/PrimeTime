# TimeTrack Power-Up pro Trello

ClickUp-inspired time tracking přímo v Trello. Sleduj čas na kartách, nastav kdo co vidí a generuj reporty.

---

## Struktura souborů

```
timetrack-powerup/
├── connector.html      ← Hlavní registrační soubor (Power-Up entry point)
├── tracker-popup.html  ← Popup s časovačem (otevírá se z každé karty)
├── settings.html       ← Admin panel – správa přístupů
├── report.html         ← Time Report (fullscreen modal, jen admini)
├── no-access.html      ← Zobrazí se členům bez admin práv
└── manifest.json       ← Metadata Power-Upu
```

---

## Permissions model

| Role | Časovač | Report | Nastavení |
|------|---------|--------|-----------|
| **Admin** | ✓ | Vidí vše (všichni členové, všechny karty) | ✓ |
| **Tracker** | ✓ | Vidí jen svůj vlastní čas | ✗ |
| **Bez přístupu** | ✗ (tlačítko se nezobrazí) | ✗ | ✗ |

**První spuštění:** Kdo jako první otevře nastavení, automaticky se stane Super Adminem.
Admin může ostatním přidávat/odebírat role přes Settings panel.

---

## Storage schéma (Trello plugin storage)

```
board / shared / 'tt-permissions'
  → { admins: [memberId, ...], trackers: [memberId, ...] }

board / shared / 'tt-logs'
  → [{ id, memberId, memberName, cardId, mins, desc, date }, ...]

card / shared / 'tt-total'
  → number (minuty, cache pro card-badge)

member / private / 'tt-running-{cardId}'
  → { startedAt: timestamp } | null
```

---

## Nasazení (krok za krokem)

### 1. Trello API Key
1. Jdi na https://trello.com/power-ups/admin
2. Vytvoř nový Power-Up → zkopíruj **API Key**
3. Vlož ho do `connector.html` na místě `YOUR_TRELLO_APP_KEY`

### 2. Hosting
Power-Up musí běžet na **HTTPS**. Možnosti:

**Vercel (doporučeno – zdarma):**
```bash
npm i -g vercel
cd timetrack-powerup
vercel --prod
# → dostaneš URL např. https://timetrack-abc123.vercel.app
```

**Netlify:**
```bash
# Přetáhni složku na netlify.com/drop
# → dostaneš URL
```

**GitHub Pages:**
```bash
git init && git add . && git commit -m "init"
gh repo create timetrack-powerup --public --push
# Zapni GitHub Pages v Settings → Pages → main branch
```

### 3. Registrace v Trello
1. https://trello.com/power-ups/admin → tvůj Power-Up → Edit
2. **Iframe connector URL** = `https://TVOJE-URL/connector.html`
3. Zaškrtni capabilities:
   - `card-badges`
   - `card-detail-badges`
   - `card-buttons`
   - `board-buttons`
   - `show-settings`
4. Ulož → přidej Power-Up na svou nástěnku

### 4. První spuštění
1. Klikni na ikonu ozubeného kolečka u Power-Upu
2. Jsi automaticky admin (první kdo Settings otevře)
3. Přiřaď role ostatním členům nástěnky
4. Uložit → hotovo

---

## Lokální vývoj

```bash
# Potřebuješ HTTPS i lokálně – Trello odmítá HTTP
npx serve . --ssl-cert ./cert.pem --ssl-key ./key.pem

# Nebo použij ngrok:
ngrok http 3000
# → zkopíruj https:// URL do Trello Power-Up admin
```

---

## Co přidat dál

- [ ] Trello Webhook pro real-time aktualizaci badges bez refreshe
- [ ] Estimate (odhadovaný čas) vs. Skutečný čas na kartě
- [ ] Export do Sheets / Jira / Harvest
- [ ] Notifikace při překročení time budgetu
- [ ] Opakující se weekly report přes email
