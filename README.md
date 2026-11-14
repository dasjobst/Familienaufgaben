# Familien-Haushaltsplaner

Gemeinsame Haushaltsaufgaben für die Familie: Katalog, Buchen und Zuweisen, Punktekonto, Eskalationsboard, Mitgliederfotos.

## Aufbau

| Teil | Ort | Aufgabe |
| --- | --- | --- |
| Oberfläche | `public/` | statische Seite (`index.html`, `app.js`, `styles.css`) |
| Fachlogik | `public/shared/logic.mjs` | Regeln für Buchen, Zuweisen, Punkte, Eskalation; läuft maßgeblich auf dem Server |
| API | `netlify/functions/api.mjs`, `netlify/lib/handler.mjs` | Netlify Function unter `/api/*` |
| Daten | Netlify Blobs, Store `haushalt` | Zustand (`state`), Sitzungen (`ses/`), Einladungen (`inv/`), Fotos (`photo/`) |

## Sicherheitsmodell

- **Einrichtung:** Das erste Elternteil legt die Familie mit dem Einrichtungscode an (Umgebungsvariable `SETUP_CODE`, mindestens 12 Zeichen). Danach ist die Einrichtung gesperrt.
- **Anmeldung:** Eltern erzeugen pro Mitglied einen Einladungslink. Der Link ist 14 Tage gültig und einmalig. Er enthält ein zufälliges Token im URL-Fragment (`#invite=…`), das nie an einen Server geschickt wird, bis die App es einlöst. Der Server speichert nur den SHA-256-Hash.
- **Sitzungen:** 180 Tage, als Hash gespeichert, per `Authorization: Bearer` gesendet. Eltern können alle Geräte einer Person abmelden.
- **Rechte:** Katalog, Zuweisen, Mitglieder, Einladungen, Bonus: nur Eltern. Fotos: die Person selbst oder Eltern. E-Mail-Adressen sehen nur Eltern und die Person selbst.
- **Gleichzeitigkeit:** Jede Änderung liest den Zustand mit ETag und schreibt nur, wenn niemand dazwischen geschrieben hat (`onlyIfMatch`), sonst wiederholt der Server. Zwei Personen können dieselbe Aufgabe nicht beide buchen.
- **Fotos:** höchstens 350 KB, nur JPEG, PNG oder WebP (Dateikopf wird geprüft). Die App verkleinert vor dem Hochladen auf 320 × 320 Pixel.

## Einrichten

1. Repo mit Netlify verbinden (Build-Befehl leer, Publish-Verzeichnis `public`, Functions `netlify/functions`; steht in `netlify.toml`).
2. Umgebungsvariable `SETUP_CODE` setzen (zufällig, mindestens 12 Zeichen, als geheim markieren).
3. Seite öffnen, Einrichtungscode, Namen und E-Mail eingeben.
4. Unter "Familie" Mitglieder anlegen und pro Mitglied einen Einladungslink erzeugen.

## Tests

```
npm test
```

Die Tests laufen gegen einen Speicher-Store mit der Schnittstelle von Netlify Blobs. Sie prüfen Einrichtung, Einladungen, Rechte, gleichzeitiges Buchen, Punkte, Fotos und Abmeldung.

## Bekannte Grenzen

- Die App verschickt keine E-Mails. Der Einladungstext wird kopiert oder im Mailprogramm geöffnet.
- Der gesamte Familienzustand liegt in einem Dokument. Das passt für eine Familie, nicht für Hunderte Nutzer.
- Überfällige Aufgaben kosten keine Punkte.
