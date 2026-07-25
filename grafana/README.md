# Grafana Dashboard – ZTE MC888

Dashboard für die vom Adapter in **InfluxDB 1.x (InfluxQL)** geloggten Signalwerte.

Datei: [`zte-mc888-influxql.json`](zte-mc888-influxql.json)

## Voraussetzung: Werte in InfluxDB loggen

Der ioBroker-InfluxDB-Adapter schreibt einen State nur, wenn dafür das Logging
aktiviert ist. Für **jeden** gewünschten Datenpunkt unter `zte-mc888.0.*`:

1. In ioBroker → **Objekte** den Datenpunkt suchen (z. B. `zte-mc888.0.nr5g.rsrp`).
2. Über das Zahnrad/Einstellungssymbol den **InfluxDB**-Reiter öffnen.
3. **„aktivieren"** anhaken (ggf. Speicherintervall/Änderungen einstellen).

Der InfluxDB-Adapter legt jeden Datenpunkt als eigene *measurement* an, deren
Name der State-ID entspricht (z. B. `zte-mc888.0.nr5g.rsrp`), mit dem Feld `value`.

## Import in Grafana

1. Grafana → **Dashboards → New → Import**.
2. `zte-mc888-influxql.json` hochladen (oder Inhalt einfügen).
3. Beim Import:
   - **InfluxDB** – deine InfluxDB-1.x-Datasource auswählen.
4. Nach dem Import oben die Dashboard-Variable **„ioBroker Instanz-Präfix"**
   prüfen. Standard ist `zte-mc888.0` – nur ändern, falls deine Instanz anders
   heißt (z. B. `zte-mc888.1`).

## Aufbau

| Abschnitt | Inhalt |
|-----------|--------|
| Status & Überblick | Verbindung, Netztyp, LTE-/5G-Band, Carrier Aggregation, Cell ID |
| 5G NR | RSRP/RSRQ/SINR/RSSI als Gauges (farbcodiert) + Signalverlauf |
| LTE | RSRP/RSRQ/SINR/RSSI als Gauges + Signalverlauf |
| Vergleich LTE ↔ 5G | RSRP- und SINR-Verlauf beider Techniken übereinander |
| Zell-Info | PCI, ARFCN, Bandbreite (LTE + 5G) |
| Carrier Aggregation | RSRP/SINR der Sekundärzellen SCC0–SCC3 |

## Farb-Schwellen der Gauges

| Metrik | 🔴 schlecht | 🟠 mäßig | 🟡 gut | 🟢 sehr gut |
|--------|------------|----------|--------|-------------|
| RSRP (dBm) | < -110 | -110…-95 | -95…-80 | ≥ -80 |
| RSRQ (dB)  | < -18  | -18…-14  | -14…-10 | ≥ -10 |
| SINR (dB)  | < 0    | 0…10     | 10…20   | ≥ 20  |
| RSSI (dBm) | < -90  | -90…-75  | -75…-65 | ≥ -65 |

Die Grenzen sind branchenübliche Richtwerte – bei Bedarf im Panel-Editor unter
*Thresholds* anpassen.

## Hinweise

- **Aktualisierung** steht auf 30 s (passend zum Poll-Intervall). Oben rechts änderbar.
- ARFCN/Bandbreite werden vom Adapter als Text gespeichert und daher als Text angezeigt.
- Bleiben Panels leer: meist ist für den Datenpunkt das InfluxDB-Logging noch nicht
  aktiviert, oder das Instanz-Präfix stimmt nicht.
