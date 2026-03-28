# PrimeTime – Trello Power-Up

Time tracking pro Trello inspirovaný ClickUpem.

## Soubory

| Soubor | Popis |
|--------|-------|
| `connector.html` | Entry point Power-Upu, registruje capabilities |
| `tracker-popup.html` | Popup s časovačem (300px, otevírá se z badge) |
| `report.html` | Time Report – fullscreen modal pro adminy |
| `settings.html` | Správa přístupů – kdo trackuje, kdo je admin |
| `no-access.html` | Zobrazí se členům bez admin práv |
| `manifest.json` | Metadata Power-Upu |

## Permissions model

| Role | Časovač | Report | Nastavení |
|------|---------|--------|-----------|
| **Admin** | ✓ | Vidí vše | ✓ |
| **Tracker** | ✓ | Jen svůj čas | ✗ |
| **Bez přístupu** | ✗ (badge se nezobrazí) | ✗ | ✗ |

První kdo otevře nastavení = automaticky Super Admin.

## Nasazení

1. Nahraj všechny soubory do GitHub repo `PrimeTime` (branch `main`)
2. Zapni GitHub Pages → `main` branch → root
3. V [Trello Power-Up Admin](https://trello.com/power-ups/admin):
   - Iframe connector URL: `https://praceburian-debug.github.io/PrimeTime/connector.html`
   - API Key: `e4d8502325aff04bbe003d7c3eea4acf`
   - Capabilities: `card-badges`, `card-detail-badges`, `board-buttons`, `show-settings`
4. Přidej Power-Up na nástěnku → otevři nastavení (ozubené kolečko) → přiřaď role
